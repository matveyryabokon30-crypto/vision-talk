"""Public passkey page: REAL Chromium WebAuthn ceremonies, MOCK provider HTTP.

The HTTP fixture calls the production WebAuthn wrapper and its pinned
SimpleWebAuthn library to verify credentials emitted by Chromium's virtual
authenticator. OAuth/storage HTTP is mocked; the handler has separate tests.
WebKit uses explicit unsupported/cancellation shims. No production request,
real Face ID, iPhone, personal information, or actual account is involved.
"""
import asyncio
import hashlib
import json
import mimetypes
import secrets
import traceback
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect
from passkey_login import b64url, unb64, cbor_item


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
EVIDENCE = ROOT / "evidence"
ORIGIN = "https://matveyryabokon30-crypto.github.io"
RP_ID = urlparse(ORIGIN).hostname
APP = ORIGIN + "/vision-talk/pablicus/"
PAGE = APP + "passkey-start.html"
API = "https://ctcoqgsztdtsazdiwcmd.supabase.co/functions/v1/pablicus-passkey"
CALLBACK = "https://ctcoqgsztdtsazdiwcmd.supabase.co/auth/v1/callback"
STORAGE = "pablicus-public-passkey-flow-v1"
SUBJECT = "11111111-1111-4111-8111-111111111111"
CALLBACK_CODE = "MOCK_ONE_USE_CODE"
CALLBACK_STATE = "MOCK_CALLBACK_STATE"


def client_data(credential, expected, ceremony):
    assert credential["type"] == "public-key"
    assert credential["id"] == credential["rawId"]
    value = unb64(credential["response"]["clientDataJSON"])
    parsed = json.loads(value)
    assert parsed["challenge"] == expected
    assert parsed["type"] == ceremony and parsed["origin"] == ORIGIN
    assert parsed.get("crossOrigin", False) is False
    return value


def authenticator_data(value):
    assert len(value) >= 37
    assert value[:32] == hashlib.sha256(RP_ID.encode()).digest()
    assert value[32] & 0x05 == 0x05, "Both presence and verification are required"
    return int.from_bytes(value[33:37], "big")


async def production_verify(kind, credential, challenge, stored_credential=None):
    """Pass browser bytes to the exact production library through stdin only."""
    process = await asyncio.create_subprocess_exec(
        "node", "--input-type=module", "-e", """
        import * as library from '@simplewebauthn/server';
        import {createWebAuthn} from './webauthn.mjs';
        let input = '';
        for await (const chunk of process.stdin) input += chunk;
        try {
          const value = JSON.parse(input);
          const verifier = createWebAuthn({library,
            rpId:'matveyryabokon30-crypto.github.io',
            origin:'https://matveyryabokon30-crypto.github.io'});
          const result = await verifier[value.kind === 'registration'
            ? 'verifyRegistration' : 'verifyAuthentication'](value);
          process.stdout.write(JSON.stringify(result));
        } catch (_) { process.exitCode = 1; }
        """, cwd=ROOT / "public-passkey", stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    output, _ = await process.communicate(json.dumps({
        "kind": kind, "credential": credential, "challenge": challenge,
        "storedCredential": stored_credential}).encode())
    return json.loads(output) if process.returncode == 0 else None


async def one(engine, engine_name):
    browser = None
    states, checks, errors, sensitive = [], [], [], []
    result = {"engine": engine_name, "pass": False, "checks": checks}
    try:
        browser = await engine.launch()

        async def make(mode="native", fragment="valid", storage_blocked=False):
            context = await browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
            state = {"events": [], "faults": [], "callbacks": 0, "keys": {}, "flow": None,
                     "secret": None, "challenge": None, "claimed": False,
                     "options_error": None, "verify_error": None, "wrong_rp": False,
                     "redirect": CALLBACK + "?code=" + CALLBACK_CODE + "&state=" + CALLBACK_STATE,
                     "signatures": 0, "registration_names": []}
            states.append(state)
            await context.add_init_script("""(() => {
              window.__keyCalls = {create:0,get:0};
              if (STORAGE_BLOCKED) Object.defineProperty(window, 'sessionStorage', {
                get() { throw new DOMException('MOCK_STORAGE_BLOCKED', 'SecurityError'); }
              });
              const mode = MODE;
              if (mode === 'unsupported') {
                Object.defineProperty(window, 'PublicKeyCredential', {value:undefined,configurable:true});
                return;
              }
              if (mode === 'cancel') {
                Object.defineProperty(window, 'PublicKeyCredential', {value:class PublicKeyCredential {},configurable:true});
                const fixture = {};
                for (const method of ['create','get']) fixture[method] = async () => {
                  window.__keyCalls[method]++;
                  throw new DOMException('MOCK_PRIVATE_UPSTREAM_TEXT', 'NotAllowedError');
                };
                Object.defineProperty(navigator, 'credentials', {value:fixture,configurable:true});
                return;
              }
              for (const method of ['create','get']) {
                const native = navigator.credentials[method];
                navigator.credentials[method] = function (...args) {
                  window.__keyCalls[method]++;
                  return native.apply(this, args);
                };
              }
            })();""".replace("STORAGE_BLOCKED", json.dumps(storage_blocked)).replace("MODE", json.dumps(mode)))
            cors = {"Access-Control-Allow-Origin": ORIGIN,
                    "Access-Control-Allow-Headers": "authorization,content-type",
                    "Access-Control-Allow-Methods": "POST,OPTIONS", "Cache-Control": "no-store"}

            async def handle(route):
                responded = False

                async def fulfill(**kwargs):
                    nonlocal responded
                    responded = True
                    await route.fulfill(**kwargs)

                try:
                    request = route.request
                    parsed = urlparse(request.url)
                    assert not parsed.fragment, "A fragment was sent over HTTP"
                    headers = await request.all_headers()
                    assert not any(state["secret"] and state["secret"] in value for key, value in headers.items() if key != "authorization")
                    if parsed.netloc == RP_ID:
                        assert not parsed.query, "Flow data must not enter a same-origin query"
                        assert parsed.path.startswith("/vision-talk/pablicus/")
                        relative = parsed.path.removeprefix("/vision-talk/pablicus/")
                        if not relative:
                            return await fulfill(status=200, content_type="text/html", body="<p>Mock main app</p>")
                        file = (DIST / relative).resolve()
                        assert file.is_relative_to(DIST.resolve())
                        return await fulfill(status=200 if file.is_file() else 404,
                                             content_type=mimetypes.guess_type(str(file))[0] or "application/octet-stream",
                                             body=file.read_bytes() if file.is_file() else b"Not found")
                    if parsed.scheme + "://" + parsed.netloc + parsed.path == CALLBACK:
                        assert request.method == "GET"
                        assert parse_qs(parsed.query) == {"code": [CALLBACK_CODE], "state": [CALLBACK_STATE]}
                        state["callbacks"] += 1
                        return await fulfill(status=200, content_type="text/html", body="<p id='mockCallback'>Mock authentication callback</p>")
                    assert request.url.startswith(API + "/"), "Unexpected network destination"
                    assert not parsed.query and "cookie" not in headers
                    path = request.url.removeprefix(API)
                    assert path in ("/registration/options", "/registration/verify", "/authentication/options", "/authentication/verify")
                    if request.method == "OPTIONS":
                        return await fulfill(status=204, headers=cors)
                    state["events"].append(path)
                    assert request.method == "POST"
                    assert headers.get("origin") == ORIGIN
                    assert headers.get("authorization") == "Bearer " + state["secret"]
                    assert not headers.get("referer"), "Requests must not disclose page URL"
                    body = request.post_data_json
                    assert body["flowId"] == state["flow"]
                    assert set(body) == ({"flowId", "name"} if path == "/registration/options" else
                                         {"flowId", "credential"} if path.endswith("/verify") else {"flowId"})
                    if path.endswith("/options"):
                        if state["options_error"]:
                            status, code = state["options_error"]
                            return await fulfill(status=status, headers=cors, content_type="application/json",
                                                 body=json.dumps({"error": code, "message": "MOCK_PRIVATE_UPSTREAM_TEXT"}))
                        assert not state["claimed"]
                        challenge = b64url(secrets.token_bytes(32))
                        state["challenge"] = challenge
                        rp = "wrong.example.invalid" if state["wrong_rp"] else RP_ID
                        if path.startswith("/registration"):
                            assert 1 <= len(body["name"]) <= 80 and body["name"] == body["name"].strip()
                            state["registration_names"].append(body["name"])
                            options = {"challenge": challenge, "rp": {"id": rp, "name": "Pablicus"},
                                       "user": {"id": b64url(SUBJECT.encode()), "name": SUBJECT, "displayName": body["name"]},
                                       "pubKeyCredParams": [{"type": "public-key", "alg": -7}],
                                       "attestation": "none", "timeout": 60000,
                                       "authenticatorSelection": {"residentKey": "required", "userVerification": "required"}}
                        else:
                            options = {"challenge": challenge, "rpId": rp, "userVerification": "required"}
                        return await fulfill(status=200, headers=cors, content_type="application/json", body=json.dumps({"options": options}))
                    assert not state["claimed"] and state["challenge"]
                    state["claimed"] = True
                    credential = body["credential"]
                    if path.startswith("/registration"):
                        client_data(credential, state["challenge"], "webauthn.create")
                        server_record = await production_verify("registration", credential, state["challenge"])
                        assert server_record and server_record["credentialId"] == credential["id"], "Production library rejected virtual registration"
                        raw = unb64(credential["response"]["attestationObject"])
                        attestation, consumed = cbor_item(raw)
                        assert consumed == len(raw) and attestation["fmt"] == "none"
                        auth_data = attestation["authData"]
                        counter = authenticator_data(auth_data)
                        assert auth_data[32] & 0x40
                        length = int.from_bytes(auth_data[53:55], "big")
                        assert auth_data[55:55 + length] == unb64(credential["id"])
                        cose, _ = cbor_item(auth_data, 55 + length)
                        assert cose[1] == 2 and cose[3] == -7 and cose[-1] == 1
                        state["keys"][credential["id"]] = {"counter": counter, "server_record": {**server_record, "subjectId": SUBJECT}, "public_key": {
                            "kty": "EC", "crv": "P-256", "x": b64url(cose[-2]), "y": b64url(cose[-3])}}
                    else:
                        signed_client = client_data(credential, state["challenge"], "webauthn.get")
                        key = state["keys"][credential["id"]]
                        auth_data = unb64(credential["response"]["authenticatorData"])
                        counter = authenticator_data(auth_data)
                        assert counter > key["counter"]
                        assert unb64(credential["response"]["userHandle"]).decode() == SUBJECT
                        proof = await production_verify("authentication", credential, state["challenge"], key["server_record"])
                        assert proof and proof["newCounter"] == counter, "Production library rejected signed assertion"
                        if not state["signatures"]:
                            assert await production_verify("authentication", credential, b64url(secrets.token_bytes(32)), key["server_record"]) is None
                        key["counter"] = counter
                        key["server_record"]["counter"] = counter
                        state["signatures"] += 1
                    if state["verify_error"]:
                        return await fulfill(status=400, headers=cors, content_type="application/json",
                                             body=json.dumps({"error": "verification_failed", "message": "MOCK_PRIVATE_UPSTREAM_TEXT"}))
                    return await fulfill(status=200, headers=cors, content_type="application/json", body=json.dumps({"redirectTo": state["redirect"]}))
                except Exception:
                    # Assertion messages contain no flow values or credential data.
                    state["faults"].append(traceback.format_exc())
                    if not responded:
                        await fulfill(status=500, headers=cors, content_type="application/json",
                                      body=json.dumps({"error": "mock_contract_failed"}))

            await context.route("**/*", handle)
            page = await context.new_page()
            page.set_default_timeout(12000)
            page.on("pageerror", lambda error: errors.append(str(error)))
            if mode == "native":
                cdp = await context.new_cdp_session(page)
                await cdp.send("WebAuthn.enable", {"enableUI": False})
                authenticator = await cdp.send("WebAuthn.addVirtualAuthenticator", {"options": {
                    "protocol": "ctap2", "transport": "internal", "hasResidentKey": True,
                    "hasUserVerification": True, "isUserVerified": True, "automaticPresenceSimulation": True}})
                state["cdp"], state["authenticator_id"] = cdp, authenticator["authenticatorId"]

            async def new_flow(fragment_mode="valid"):
                state["flow"], state["secret"] = str(uuid.uuid4()), b64url(secrets.token_bytes(32))
                sensitive.extend([state["flow"], state["secret"]])
                state["challenge"], state["claimed"] = None, False
                # Starting another fragment on the same document would not run
                # its bootstrap again. A real restart originates in the app.
                await page.goto(APP)
                suffix = "#flow=" + state["flow"] + "&secret=" + state["secret"]
                if fragment_mode == "missing":
                    suffix = ""
                    await page.evaluate("sessionStorage.clear()")
                elif fragment_mode == "duplicate":
                    suffix += "&flow=" + state["flow"]
                elif fragment_mode == "query":
                    suffix = "?flow=invalid" + suffix
                await page.goto(PAGE + suffix, wait_until="networkidle")
                assert page.url == PAGE, "The fragment/query must be removed before interaction"
                return page

            state["new_flow"] = new_flow
            await new_flow(fragment)
            return page, state

        async def stored(page):
            return await page.evaluate("sessionStorage.getItem(" + json.dumps(STORAGE) + ")")

        async def unchanged(page, state):
            assert not state["events"]
            assert await page.evaluate("window.__keyCalls") == {"create": 0, "get": 0}
            assert await page.evaluate("localStorage.length") == 0

        async def settled(page):
            # wait_for_function internally evals its predicate, which this
            # page's intentional script-src 'self' forbids. Locator assertions
            # wait for the same observable state without relaxing its CSP.
            await expect(page.locator("#passkeyStart")).to_have_attribute("aria-busy", "false")
            assert "MOCK_PRIVATE_UPSTREAM_TEXT" not in await page.locator("body").inner_text()

        for fragment in ("missing", "duplicate"):
            page, state = await make("cancel", fragment)
            await unchanged(page, state)
            assert await page.locator("#createKey").is_disabled()
            assert await page.locator("#restartLogin").is_visible()
            assert await stored(page) is None
        checks.append("Missing or duplicate fragment values fail closed before network or native prompts")

        page, state = await make("unsupported")
        await unchanged(page, state)
        assert await page.locator("#createKey").is_disabled() and await page.locator("#useKey").is_disabled()
        assert "Safari" in await page.locator("#passkeyStatus").inner_text()
        assert await page.locator("#restartLogin").is_visible()
        checks.append("Unsupported browser shows an actionable fallback and cannot create an account")

        page, state = await make("cancel", storage_blocked=True)
        await unchanged(page, state)
        assert await page.locator("#createKey").is_disabled()
        checks.append("Unavailable sessionStorage fails closed without an alternate store or API request")

        page, state = await make("cancel")
        await unchanged(page, state)
        assert await stored(page) is not None
        assert not await page.locator("input[type=password],input[type=email],input[type=tel]").count()
        await page.reload(wait_until="networkidle")
        await unchanged(page, state)
        assert not await page.locator("#createKey").is_disabled()
        assert await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        await page.locator("#createKey").click()
        assert not state["events"] and "Введите имя" in await page.locator("#passkeyStatus").inner_text()
        await page.locator("#displayName").fill("   Тестовый собеседник   ")
        for attempt in (1, 2):
            await page.locator("#createKey").click()
            await settled(page)
            assert await page.evaluate("window.__keyCalls.create") == attempt
            assert len(state["events"]) == attempt and not state["claimed"]
            assert not await page.locator("#createKey").is_disabled()
        assert state["registration_names"] == ["Тестовый собеседник", "Тестовый собеседник"]
        assert await stored(page) is not None
        await page.screenshot(path=str(EVIDENCE / (engine_name + "-public-passkey-cancelled-MOCK.png")))
        checks.append("Name-only mobile page survives reload; trimmed name validation and cancelled creation can retry without verification")

        await page.locator("#useKey").click()
        await settled(page)
        assert await page.evaluate("window.__keyCalls.get") == 1
        assert state["events"][-1] == "/authentication/options" and not state["claimed"]
        checks.append("Existing-key login is an explicit separate action without name, password or email")

        page, state = await make("cancel")
        state["wrong_rp"] = True
        await page.locator("#useKey").click()
        await settled(page)
        assert await page.evaluate("window.__keyCalls") == {"create": 0, "get": 0}
        assert await stored(page) is None and await page.locator("#restartLogin").is_visible()
        checks.append("Options for another RP are rejected before invoking WebAuthn")

        for server_status in (410, 429, 503):
            page, state = await make("cancel")
            state["options_error"] = (server_status, "fixture_bounded_error")
            await page.locator("#useKey").click()
            await settled(page)
            assert await page.evaluate("window.__keyCalls") == {"create": 0, "get": 0}
            if server_status == 429:
                assert not await page.locator("#useKey").is_disabled()
            else:
                assert await stored(page) is None and await page.locator("#restartLogin").is_visible()
        checks.append("Expired flow, rate limit and unavailable provider use bounded Russian errors without upstream text")

        if engine_name == "chromium":
            page, state = await make()
            await unchanged(page, state)
            await page.locator("#displayName").fill("Тестовый собеседник")
            await page.locator("#createKey").click()
            await page.wait_for_selector("#mockCallback")
            assert state["events"] == ["/registration/options", "/registration/verify"]
            assert state["callbacks"] == 1 and len(state["keys"]) == 1
            credentials = await state["cdp"].send("WebAuthn.getCredentials", {"authenticatorId": state["authenticator_id"]})
            assert len(credentials["credentials"]) == 1
            assert credentials["credentials"][0]["isResidentCredential"]
            assert credentials["credentials"][0]["rpId"] == RP_ID
            await state["new_flow"]()
            await page.locator("#useKey").click()
            await page.wait_for_selector("#mockCallback")
            assert state["signatures"] == 1 and state["callbacks"] == 2
            await page.goto(APP)
            assert await stored(page) is None and await page.evaluate("localStorage.length") == 0
            checks.append("REAL Chromium resident key through pinned production SimpleWebAuthn: registration validates RP, challenge and UP/UV; repeat login verifies ES256 signature, rejects changed challenge and clears flow before the fixed callback")

            bad_targets = [
                "https://attacker.example.invalid/?code=x&state=y",
                CALLBACK + "/other?code=x&state=y",
                CALLBACK + "?code=x&state=y&redirect_to=https://attacker.example.invalid",
                CALLBACK + "?code=x&code=y&state=z",
                CALLBACK + "?code=x&state=y#credential",
                CALLBACK + "?code=&state=y",
                "https://user:password@ctcoqgsztdtsazdiwcmd.supabase.co/auth/v1/callback?code=x&state=y",
            ]
            for target in bad_targets:
                await state["new_flow"]()
                state["redirect"] = target
                previous = state["callbacks"]
                await page.locator("#useKey").click()
                await settled(page)
                assert state["callbacks"] == previous and page.url == PAGE
                assert await stored(page) is None and await page.locator("#restartLogin").is_visible()
                assert await page.locator("#createKey").is_disabled()
            checks.append("Seven invalid callback forms, including credentials, fragments, duplicate and added parameters, are rejected after real signed assertions")

            await state["new_flow"]()
            state["verify_error"] = True
            await page.locator("#useKey").click()
            await settled(page)
            assert state["claimed"] and await stored(page) is None
            assert await page.locator("#useKey").is_disabled()
            await page.reload(wait_until="networkidle")
            assert await page.locator("#useKey").is_disabled()
            checks.append("A consumed verification failure clears the flow and cannot silently retry after reload")

            page, state = await make()
            await state["cdp"].send("WebAuthn.setAutomaticPresenceSimulation", {"authenticatorId": state["authenticator_id"], "enabled": False})
            await page.locator("#displayName").fill("Тестовый собеседник")
            await page.locator("#createKey").click()
            await expect(page.locator("#passkeyStatus")).to_contain_text("Создайте ключ доступа")
            assert await page.evaluate("window.__keyCalls.create") == 1
            await page.evaluate("document.getElementById('createAccount').dispatchEvent(new Event('submit', {cancelable:true}))")
            await page.evaluate("document.getElementById('useKey').dispatchEvent(new MouseEvent('click'))")
            assert state["events"] == ["/registration/options"]
            assert await page.locator("#cancelKey").is_visible()
            await page.locator("#cancelKey").click()
            await settled(page)
            assert state["events"] == ["/registration/options"] and not state["claimed"]
            assert not await page.locator("#createKey").is_disabled()
            await state["cdp"].send("WebAuthn.setAutomaticPresenceSimulation", {"authenticatorId": state["authenticator_id"], "enabled": True})
            await page.locator("#createKey").click()
            await page.wait_for_selector("#mockCallback")
            assert state["events"] == ["/registration/options", "/registration/options", "/registration/verify"]
            checks.append("A pending REAL native prompt is single-flight; explicit cancellation prevents verification and permits a fresh successful challenge")

        assert not errors
        assert not any(state["faults"] for state in states)
        result.update({"pass": True, "scope": "BUILT_PAGE_MOCK_PROVIDER_HTTP",
                       "ceremony": "REAL_CHROMIUM_VIRTUAL_AUTHENTICATOR" if engine_name == "chromium" else "EXPLICIT_FALLBACK_API_SHIMS",
                       "verification_library": "PRODUCTION_SIMPLEWEBAUTHN_13.3.0" if engine_name == "chromium" else "NOT_APPLICABLE",
                       "production_provider": "NOT_TESTED", "physical_iPhone": False, "real_Face_ID": False})
    except Exception:
        result.update({"error": traceback.format_exc()})
    finally:
        # Never persist generated flow secrets, private key material, names,
        # callback codes, credential IDs or assertions in evidence output.
        result["states"] = [{"events": state["events"], "faults": state["faults"],
                             "callbacks": state["callbacks"], "signatures": state["signatures"]} for state in states]
        result["errors"] = errors
        if browser:
            await browser.close()
        serialized = json.dumps(result, ensure_ascii=False, indent=2)
        for value in sensitive:
            serialized = serialized.replace(value, "[REDACTED_FIXTURE_FLOW]")
        result = json.loads(serialized)
        (EVIDENCE / (engine_name + "-public-passkey-page.json")).write_text(serialized)
    return result


async def main():
    EVIDENCE.mkdir(exist_ok=True)
    assert all((DIST / filename).is_file() for filename in ("passkey-start.html", "passkey-start.js", "passkey-start.css"))
    results = []
    async with async_playwright() as playwright:
        for name in ("chromium", "webkit"):
            results.append(await one(getattr(playwright, name), name))
            (EVIDENCE / "public-passkey-page.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False))
    assert len(results) == 2 and all(result["pass"] for result in results)


if __name__ == "__main__":
    asyncio.run(main())
