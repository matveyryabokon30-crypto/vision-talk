"""Passkey browser contract: real bundle, Chromium virtual WebAuthn, MOCK HTTP.

Chromium creates a real resident credential and signs server fixture challenges.
The fixture verifies its public key, RP/origin, user verification, challenge and
ES256 signature. Supabase HTTP is mocked and every other destination is blocked.
WebKit tests only unsupported/cancelled API contracts using an explicit shim.
Neither a production account/server nor Face ID, Touch ID or physical iPhone is
tested. Run against built dist with Playwright browsers and Node installed.
"""
import asyncio
import base64
import hashlib
import json
import mimetypes
import secrets
import time
import traceback
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
EVIDENCE = ROOT / "evidence"
SITE = "https://pablicus-test.example.invalid/"
ORIGIN = SITE.rstrip("/")
RP_ID = urlparse(SITE).hostname
PROJECT_HOST = "ctcoqgsztdtsazdiwcmd.supabase.co"
STORAGE_KEY = "sb-ctcoqgsztdtsazdiwcmd-auth-token"
USER_ID = "11111111-1111-4111-8111-111111111111"
OTHER_ID = "22222222-2222-4222-8222-222222222222"
KEY_ID = "33333333-3333-4333-8333-333333333333"
FIXTURE_PASSWORD = "MOCK_PASSWORD_NOT_A_CREDENTIAL"


def b64url(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def unb64(value):
    assert isinstance(value, str)
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def fixture_session(*, confirmed=True, user_id=USER_ID):
    now = int(time.time())
    user = {
        "id": user_id, "email": "passkey-qa@example.invalid",
        "aud": "authenticated", "role": "authenticated", "is_anonymous": False,
        "app_metadata": {"provider": "email", "providers": ["email"]},
        "user_metadata": {}, "created_at": "2026-09-08T00:00:00Z",
    }
    if confirmed:
        user["email_confirmed_at"] = "2026-09-08T00:00:00Z"
        user["confirmed_at"] = user["email_confirmed_at"]
    token = ".".join([
        b64url(b'{"alg":"HS256","typ":"JWT"}'),
        b64url(json.dumps({"sub": user_id, "exp": now + 3600, "iat": now,
                           "aud": "authenticated", "role": "authenticated"}).encode()),
        "MOCK_SIGNATURE_NOT_A_CREDENTIAL",
    ])
    return {
        "access_token": token, "refresh_token": "MOCK_REFRESH_NOT_A_CREDENTIAL",
        "expires_in": 3600, "expires_at": now + 3600, "token_type": "bearer",
        "user": user,
    }


def cbor_item(data, offset=0):
    """Read the definite-length CBOR subset emitted by this virtual authenticator.

    This fixture decoder is deliberately not a production attestation verifier.
    """
    assert offset < len(data), "Truncated fixture CBOR"
    initial = data[offset]
    major, size = initial >> 5, initial & 31
    offset += 1
    if size >= 24:
        width = {24: 1, 25: 2, 26: 4, 27: 8}.get(size)
        assert width and offset + width <= len(data), "Unsupported fixture CBOR"
        size = int.from_bytes(data[offset:offset + width], "big")
        offset += width
    if major in (0, 1):
        return (size if major == 0 else -1 - size), offset
    if major in (2, 3):
        assert offset + size <= len(data)
        value = data[offset:offset + size]
        return (value if major == 2 else value.decode()), offset + size
    if major == 4:
        value = []
        for _ in range(size):
            item, offset = cbor_item(data, offset)
            value.append(item)
        return value, offset
    if major == 5:
        value = {}
        for _ in range(size):
            key, offset = cbor_item(data, offset)
            item, offset = cbor_item(data, offset)
            assert key not in value
            value[key] = item
        return value, offset
    raise AssertionError("Unexpected virtual-authenticator CBOR type")


def validate_client(credential, challenge, ceremony):
    assert credential["type"] == "public-key"
    assert unb64(credential["rawId"]) == unb64(credential["id"])
    client_data = unb64(credential["response"]["clientDataJSON"])
    client = json.loads(client_data)
    assert client["type"] == ceremony
    assert client["challenge"] == challenge
    assert client["origin"] == ORIGIN
    assert client.get("crossOrigin", False) is False
    return client_data


def validate_authenticator(data):
    assert len(data) >= 37
    assert data[:32] == hashlib.sha256(RP_ID.encode()).digest(), "Wrong RP hash"
    assert data[32] & 0x05 == 0x05, "User presence and verification are required"
    return int.from_bytes(data[33:37], "big")


async def valid_signature(public_key, authenticator_data, client_data, signature):
    # Node is already installed by the candidate workflow. Its standard crypto
    # API verifies the DER ES256 signature using the public key from attestation.
    process = await asyncio.create_subprocess_exec(
        "node", "-e", """
        const crypto = require('node:crypto');
        let input = '';
        process.stdin.on('data', chunk => input += chunk);
        process.stdin.on('end', () => {
          try {
            const f = JSON.parse(input);
            const key = crypto.createPublicKey({key:f.key, format:'jwk'});
            const ok = crypto.verify('sha256', Buffer.from(f.data,'base64'),
              key, Buffer.from(f.signature,'base64'));
            process.exitCode = ok ? 0 : 1;
          } catch (_) { process.exitCode = 1; }
        });
        """,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    signed = authenticator_data + hashlib.sha256(client_data).digest()
    await process.communicate(json.dumps({
        "key": public_key, "data": base64.b64encode(signed).decode(),
        "signature": base64.b64encode(signature).decode(),
    }).encode())
    return process.returncode == 0


async def one(engine, name):
    contexts, states, checks, errors = [], [], [], []
    browser = None
    result = {"engine": name, "pass": False, "checks": checks}

    async def make(*, enabled=True, signed_in=False, confirmed=True,
                   approved=True, api="native", origin=ORIGIN):
        context = await browser.new_context(
            viewport={"width": 390, "height": 844}, service_workers="block",
        )
        contexts.append(context)
        state = {
            "events": [], "faults": [], "registration_options": 0,
            "registration_verify": 0, "authentication_options": 0,
            "authentication_verify": 0, "successful_assertions": 0,
            "get_user": 0, "profiles": 0, "conversations": 0, "storage_usage": 0,
            "logout_fail": False, "logout_failures": 0,
            "approved": approved, "confirmed": confirmed, "server_user_id": USER_ID,
            "credentials": {}, "challenges": {}, "verifier_negative_checks": [],
        }
        states.append(state)
        session = fixture_session(confirmed=confirmed) if signed_in else None
        await context.add_init_script("""(() => {
          const session = SESSION;
          if (session && !sessionStorage.getItem('passkey-fixture-seeded')) {
            localStorage.setItem(STORAGE, JSON.stringify(session));
            sessionStorage.setItem('passkey-fixture-seeded', 'true');
          }
          window.__passkeyCalls = {create:0,get:0};
          const api = API;
          if (api === 'unsupported') {
            Object.defineProperty(window, 'PublicKeyCredential', {value:undefined,configurable:true});
            return;
          }
          if (api === 'cancel') {
            if (typeof window.PublicKeyCredential !== 'function') {
              Object.defineProperty(window, 'PublicKeyCredential', {
                value:class PublicKeyCredential {}, configurable:true
              });
            }
            const cancelled = {};
            for (const method of ['create','get']) cancelled[method] = async () => {
              window.__passkeyCalls[method]++;
              throw new DOMException('MOCK_BROWSER_CANCELLATION', 'NotAllowedError');
            };
            Object.defineProperty(navigator, 'credentials', {value:cancelled,configurable:true});
            return;
          }
          // Count invocations while forwarding the original browser API unchanged.
          for (const method of ['create','get']) {
            const native = navigator.credentials[method];
            navigator.credentials[method] = function (...args) {
              window.__passkeyCalls[method]++;
              return native.apply(this, args);
            };
          }
        })();""".replace("SESSION", json.dumps(session))
             .replace("STORAGE", json.dumps(STORAGE_KEY)).replace("API", json.dumps(api)))

        async def handle(route):
            responded = False

            async def fulfill(**kwargs):
                nonlocal responded
                responded = True
                await route.fulfill(**kwargs)

            parsed = urlparse(route.request.url)
            query = parse_qs(parsed.query)
            headers = {
                "access-control-allow-origin": "*", "access-control-allow-headers": "*",
                "access-control-allow-methods": "GET,POST,OPTIONS",
            }
            try:
                if parsed.netloc == urlparse(SITE).netloc:
                    if parsed.path.endswith("/auth-config.js"):
                        config = {
                            "publicSignupReady": False, "providers": {},
                            "passkeys": {"enabled": enabled, "rpId": RP_ID, "origin": origin},
                        }
                        return await fulfill(status=200, content_type="application/javascript",
                                             body="window.PablicusAuthConfig=" + json.dumps(config) + ";")
                    file = (DIST / (parsed.path.lstrip("/") or "index.html")).resolve()
                    assert file.is_relative_to(DIST.resolve())
                    return await fulfill(
                        status=200 if file.is_file() else 404,
                        content_type=mimetypes.guess_type(str(file))[0] or "application/octet-stream",
                        body=file.read_bytes() if file.is_file() else b"Not found",
                    )
                if parsed.netloc != PROJECT_HOST:
                    raise AssertionError("Unexpected network destination: " + parsed.netloc)
                if route.request.method == "OPTIONS":
                    return await fulfill(status=204, headers=headers)
                path = parsed.path.removeprefix("/auth/v1")
                state["events"].append(path)
                body = route.request.post_data_json if route.request.post_data else {}
                payload, status = {}, 200

                def require_session():
                    authorization = route.request.headers.get("authorization", "")
                    assert authorization.startswith("Bearer ")
                    claims = json.loads(unb64(authorization.removeprefix("Bearer ").split(".")[1]))
                    assert claims["sub"] == USER_ID

                def challenge_options(ceremony):
                    challenge_id = secrets.token_hex(16)
                    challenge = b64url(secrets.token_bytes(32))
                    state["challenges"][challenge_id] = {"value": challenge, "type": ceremony}
                    return challenge_id, challenge

                if path == "/token":
                    assert query.get("grant_type") == ["password"]
                    assert body.get("email") == "passkey-qa@example.invalid"
                    assert body.get("password") == FIXTURE_PASSWORD
                    payload = fixture_session(confirmed=state["confirmed"])
                elif path == "/user":
                    require_session()
                    state["get_user"] += 1
                    payload = fixture_session(confirmed=state["confirmed"], user_id=state["server_user_id"])["user"]
                elif path == "/logout":
                    require_session()
                    if state["logout_fail"]:
                        state["logout_failures"] += 1
                        status, payload = 500, {"code": "unexpected_failure", "msg": "MOCK_LOGOUT_UNAVAILABLE"}
                elif parsed.path == "/rest/v1/profiles":
                    require_session()
                    state["profiles"] += 1
                    assert query.get("id") == ["eq." + USER_ID]
                    payload = {"id": USER_ID, "username": "passkey_qa", "display_name": "Passkey QA",
                               "avatar_url": None, "is_approved": state["approved"]}
                elif parsed.path.startswith("/rest/v1/rpc/my_conversations"):
                    state["conversations"] += 1
                    payload = []
                elif parsed.path == "/rest/v1/rpc/pablicus_storage_usage":
                    require_session()
                    assert route.request.method == "POST" and body == {}
                    state["storage_usage"] += 1
                    # This auth fixture owns no uploaded objects.
                    payload = [{"total_bytes": 0, "own_bytes": 0,
                                "object_count": 0, "own_object_count": 0,
                                "unknown_size_count": 0,
                                "measured_at": "2026-09-09T00:00:00Z"}]
                elif path == "/passkeys":
                    require_session()
                    assert route.request.method == "GET"
                    payload = [key["metadata"] for key in state["credentials"].values()]
                elif path == "/passkeys/registration/options":
                    require_session()
                    state["registration_options"] += 1
                    assert state["server_user_id"] == USER_ID and state["confirmed"] and state["approved"]
                    assert body == {}
                    challenge_id, challenge = challenge_options("webauthn.create")
                    payload = {"challenge_id": challenge_id, "expires_at": int(time.time()) + 300,
                               "options": {
                                   "challenge": challenge, "rp": {"id": RP_ID, "name": "Pablicus fixture"},
                                   "user": {"id": b64url(USER_ID.encode()), "name": "passkey-qa@example.invalid", "displayName": "Passkey QA"},
                                   "pubKeyCredParams": [{"type": "public-key", "alg": -7}],
                                   "timeout": 60000, "attestation": "none",
                                   "authenticatorSelection": {"authenticatorAttachment": "platform", "residentKey": "required", "requireResidentKey": True, "userVerification": "required"},
                                   "excludeCredentials": [{"type": "public-key", "id": key_id} for key_id in state["credentials"]],
                               }}
                elif path == "/passkeys/registration/verify":
                    require_session()
                    state["registration_verify"] += 1
                    assert state["server_user_id"] == USER_ID and state["confirmed"] and state["approved"]
                    challenge = state["challenges"].pop(body["challenge_id"])
                    assert challenge["type"] == "webauthn.create"
                    credential = body["credential"]
                    validate_client(credential, challenge["value"], "webauthn.create")
                    attestation_bytes = unb64(credential["response"]["attestationObject"])
                    attestation, consumed = cbor_item(attestation_bytes)
                    assert consumed == len(attestation_bytes) and attestation["fmt"] == "none"
                    auth_data = attestation["authData"]
                    counter = validate_authenticator(auth_data)
                    assert auth_data[32] & 0x40, "Missing attested credential data"
                    length = int.from_bytes(auth_data[53:55], "big")
                    assert auth_data[55:55 + length] == unb64(credential["id"])
                    cose, _ = cbor_item(auth_data, 55 + length)
                    assert cose[1] == 2 and cose[3] == -7 and cose[-1] == 1
                    assert len(cose[-2]) == 32 and len(cose[-3]) == 32
                    payload = {"id": KEY_ID, "friendly_name": "Virtual test key", "created_at": "2026-09-08T00:00:00Z"}
                    state["credentials"][credential["id"]] = {
                        "user_id": USER_ID, "counter": counter, "metadata": payload,
                        "public_key": {"kty": "EC", "crv": "P-256", "x": b64url(cose[-2]), "y": b64url(cose[-3])},
                    }
                elif path == "/passkeys/authentication/options":
                    state["authentication_options"] += 1
                    assert set(body) <= {"gotrue_meta_security"}
                    challenge_id, challenge = challenge_options("webauthn.get")
                    # No email and no allowCredentials: select the resident key.
                    payload = {"challenge_id": challenge_id, "expires_at": int(time.time()) + 300,
                               "options": {"challenge": challenge, "rpId": RP_ID,
                                           "userVerification": "required", "timeout": 60000}}
                elif path == "/passkeys/authentication/verify":
                    state["authentication_verify"] += 1
                    challenge = state["challenges"].pop(body["challenge_id"])
                    assert challenge["type"] == "webauthn.get"
                    credential = body["credential"]
                    client_data = validate_client(credential, challenge["value"], "webauthn.get")
                    key = state["credentials"][credential["id"]]
                    response = credential["response"]
                    auth_data = unb64(response["authenticatorData"])
                    counter = validate_authenticator(auth_data)
                    assert counter > key["counter"], "Assertion counter did not advance"
                    assert unb64(response["userHandle"]).decode() == key["user_id"] == USER_ID
                    signature = unb64(response["signature"])
                    assert await valid_signature(key["public_key"], auth_data, client_data, signature), "Invalid assertion signature"
                    if not state["verifier_negative_checks"]:
                        # Establish that the HTTP fixture actually detects a changed
                        # signature/challenge; this is not production-server evidence.
                        corrupted = bytes([signature[0] ^ 1]) + signature[1:]
                        assert not await valid_signature(key["public_key"], auth_data, client_data, corrupted)
                        assert not await valid_signature(key["public_key"], auth_data, client_data + b" ", signature)
                        assert body["challenge_id"] not in state["challenges"]
                        assert b64url(b"wrong-key") not in state["credentials"]
                        state["verifier_negative_checks"] = ["signature", "signed_client_data", "consumed_challenge", "unknown_credential"]
                    key["counter"] = counter
                    state["successful_assertions"] += 1
                    payload = fixture_session(confirmed=state["confirmed"], user_id=key["user_id"])
                else:
                    raise AssertionError("Unexpected mocked endpoint: " + parsed.path)
                await fulfill(status=status, headers=headers, content_type="application/json", body=json.dumps(payload))
            except Exception:
                state["faults"].append(traceback.format_exc())
                if not responded:
                    await fulfill(status=500, headers=headers, content_type="application/json",
                                  body=json.dumps({"code": "mock_contract_failed", "msg": "Mock contract failed"}))

        await context.route("**/*", handle)
        page = await context.new_page()
        page.set_default_timeout(12000)
        page.on("pageerror", lambda error: errors.append(str(error)))
        if name == "chromium" and api == "native":
            cdp = await context.new_cdp_session(page)
            await cdp.send("WebAuthn.enable", {"enableUI": False})
            authenticator = await cdp.send("WebAuthn.addVirtualAuthenticator", {"options": {
                "protocol": "ctap2", "transport": "internal", "hasResidentKey": True,
                "hasUserVerification": True, "isUserVerified": True,
                "automaticPresenceSimulation": True,
            }})
            state["cdp"] = cdp
            state["authenticator_id"] = authenticator["authenticatorId"]
        await page.goto(SITE, wait_until="domcontentloaded")
        await page.wait_for_function("typeof PablicusDebug !== 'undefined'")
        return page, state

    async def assert_closed(page):
        await page.wait_for_selector("#loginPane", state="visible")
        assert not await page.locator("#workspace").is_visible()
        assert await page.evaluate("PablicusDebug.user == null")

    async def assert_no_prompt(page, state):
        await page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        assert await page.evaluate("window.__passkeyCalls") == {"create": 0, "get": 0}
        assert state["registration_options"] == state["authentication_options"] == 0

    async def profile(page):
        await page.wait_for_selector("#workspace", state="visible")
        await page.locator('#mainNav [data-page="profile"]').click()
        await page.wait_for_selector("#screenContent .profileCard", state="visible")

    async def sign_out(page):
        await profile(page)
        await page.get_by_role("button", name="Выйти", exact=True).click()
        await assert_closed(page)
        assert await page.evaluate("localStorage.getItem(" + json.dumps(STORAGE_KEY) + ")") is None

    async def watch_workspace(page):
        await page.evaluate("""() => {
          window.__passkeyWorkspaceExposed = false;
          new MutationObserver(records => {
            // Attribute oldValue also catches an expose/hide pair in one task.
            if (records.some(record => record.oldValue === null) ||
                !document.getElementById('workspace').hidden) {
              window.__passkeyWorkspaceExposed = true;
            }
          }).observe(document.getElementById('workspace'), {
            attributes:true, attributeFilter:['hidden'], attributeOldValue:true
          });
        }""")

    async def wait_login_error(page):
        await page.wait_for_function("""() =>
          !document.getElementById('passkeySignIn').disabled &&
          (document.getElementById('passkeyLoginStatus').textContent.trim() ||
           document.getElementById('loginError').textContent.trim())
        """)
        await assert_closed(page)

    try:
        browser = await engine.launch(headless=True)
        disabled, state = await make(enabled=False, api="native" if name == "chromium" else "cancel")
        await assert_closed(disabled)
        assert not await disabled.locator("#passkeyLogin").is_visible()
        await assert_no_prompt(disabled, state)
        checks.append("Explicit disabled configuration hides passkeys and invokes no credential API")

        unsupported, state = await make(api="unsupported")
        await assert_closed(unsupported)
        assert not await unsupported.locator("#passkeyLogin").is_visible()
        await assert_no_prompt(unsupported, state)
        await unsupported.locator("#email").fill("passkey-qa@example.invalid")
        await unsupported.locator("#password").fill(FIXTURE_PASSWORD)
        await unsupported.locator("#loginSubmit").click()
        await unsupported.wait_for_selector("#workspace", state="visible")
        assert await unsupported.evaluate("PablicusDebug.user") == USER_ID
        checks.append("Explicit unsupported-browser shim hides passkeys; password fallback still signs in")

        wrong_origin, state = await make(origin="https://wrong.example.invalid", api="cancel")
        await assert_closed(wrong_origin)
        assert not await wrong_origin.locator("#passkeyLogin").is_visible()
        await assert_no_prompt(wrong_origin, state)
        checks.append("A passkey configuration for another origin cannot enable the login control")

        cancelled, state = await make(api="cancel")
        await cancelled.wait_for_selector("#passkeySignIn", state="visible")
        await assert_no_prompt(cancelled, state)
        for attempt in (1, 2):
            await cancelled.locator("#passkeySignIn").click()
            await cancelled.wait_for_function("window.__passkeyCalls.get === " + str(attempt))
            await wait_login_error(cancelled)
            assert state["authentication_options"] == attempt
            assert state["authentication_verify"] == 0
            assert "MOCK_BROWSER_CANCELLATION" not in await cancelled.locator("body").inner_text()
        checks.append("Explicit NotAllowedError API shim keeps login closed and lets cancelled credential selection retry twice")

        if name == "chromium":
            page, state = await make(signed_in=True)
            await profile(page)
            await page.wait_for_selector("#passkeyRegister", state="visible")
            await assert_no_prompt(page, state)
            await page.locator("#passkeyRegister").click()
            await page.wait_for_function("document.querySelectorAll('#passkeyList li').length === 1 && !document.getElementById('passkeyRegister').disabled")
            assert state["registration_options"] == state["registration_verify"] == 1
            assert len(state["credentials"]) == 1
            assert await page.evaluate("window.__passkeyCalls") == {"create": 1, "get": 0}
            credentials = await state["cdp"].send("WebAuthn.getCredentials", {"authenticatorId": state["authenticator_id"]})
            assert len(credentials["credentials"]) == 1
            assert credentials["credentials"][0]["isResidentCredential"]
            assert credentials["credentials"][0]["rpId"] == RP_ID
            await page.screenshot(path=str(EVIDENCE / "chromium-passkey-enrolled-VIRTUAL.png"))
            await sign_out(page)
            event_start = len(state["events"])
            await page.locator("#passkeySignIn").click()
            await page.wait_for_selector("#workspace", state="visible")
            assert await page.evaluate("PablicusDebug.user") == USER_ID
            events = state["events"][event_start:]
            assert events.index("/passkeys/authentication/verify") < events.index("/user") < events.index("/rest/v1/profiles")
            assert state["successful_assertions"] == 1
            assert await page.evaluate("window.__passkeyCalls") == {"create": 1, "get": 1}
            checks.append("REAL Chromium virtual resident key: explicit enrollment with UP/UV, ES256 signature verification, signout and key login preserve the confirmed approved UID")

            for denied_by in ("identity", "profile"):
                if await page.locator("#workspace").is_visible():
                    await sign_out(page)
                else:
                    await assert_closed(page)
                state["server_user_id"] = OTHER_ID if denied_by == "identity" else USER_ID
                state["approved"] = denied_by != "profile"
                before_profiles, before_conversations = state["profiles"], state["conversations"]
                before_verifies = state["authentication_verify"]
                await watch_workspace(page)
                await page.locator("#passkeySignIn").click()
                await page.wait_for_function("window.__passkeyCalls.get >= " + str(before_verifies + 1))
                await wait_login_error(page)
                assert state["authentication_verify"] == before_verifies + 1
                assert not await page.evaluate("window.__passkeyWorkspaceExposed")
                assert state["conversations"] == before_conversations
                if denied_by == "identity":
                    assert state["profiles"] == before_profiles
                else:
                    assert state["profiles"] > before_profiles
                assert await page.evaluate("localStorage.getItem(" + json.dumps(STORAGE_KEY) + ")") is None
                checks.append("REAL signed assertion fails closed after " + denied_by + " rejection, with no transient workspace or conversation fetch")

            # A rejected login must never enter the main persistent Auth store,
            # even when the server refuses to revoke its temporary session.
            state["server_user_id"], state["approved"], state["logout_fail"] = OTHER_ID, True, True
            before_profiles, before_conversations = state["profiles"], state["conversations"]
            before_verifies = state["authentication_verify"]
            await watch_workspace(page)
            await page.locator("#passkeySignIn").click()
            await page.wait_for_function("window.__passkeyCalls.get >= " + str(before_verifies + 1))
            await wait_login_error(page)
            assert state["authentication_verify"] == before_verifies + 1
            assert state["logout_failures"] >= 1, "The failing cleanup endpoint was not exercised"
            assert not await page.evaluate("window.__passkeyWorkspaceExposed")
            assert await page.evaluate("localStorage.getItem(" + json.dumps(STORAGE_KEY) + ")") is None
            await page.reload(wait_until="networkidle")
            await page.wait_for_function("typeof PablicusDebug !== 'undefined'")
            await assert_closed(page)
            assert await page.evaluate("localStorage.getItem(" + json.dumps(STORAGE_KEY) + ")") is None
            assert await page.evaluate("window.__passkeyCalls") == {"create": 0, "get": 0}
            assert state["profiles"] == before_profiles and state["conversations"] == before_conversations
            checks.append("REAL signed assertion rejected by identity validation stays absent from main Auth storage and cannot restore a workspace after HTTP 500 logout cleanup and reload")

            unconfirmed, state = await make(signed_in=True, confirmed=False)
            await profile(unconfirmed)
            register = unconfirmed.locator("#passkeyRegister")
            if await register.is_visible():
                # The UI can explain eligibility after a click; the important
                # boundary is refusing before any challenge or browser prompt.
                await register.click()
                await unconfirmed.wait_for_function("""() =>
                  !document.getElementById('passkeyRegister').disabled &&
                  document.getElementById('passkeySettingsStatus').textContent.trim()
                """)
            await assert_no_prompt(unconfirmed, state)
            checks.append("An approved profile with unconfirmed identity cannot enroll a key")

            for changed_gate in ("identity", "approval"):
                guarded, state = await make(signed_in=True)
                await profile(guarded)
                await guarded.wait_for_function("!document.getElementById('passkeyRegister').disabled")
                if changed_gate == "identity":
                    state["server_user_id"] = OTHER_ID
                else:
                    state["approved"] = False
                await guarded.locator("#passkeyRegister").click()
                await guarded.wait_for_function("""() =>
                  !document.getElementById('passkeyRegister').disabled &&
                  document.getElementById('passkeySettingsStatus').textContent.trim()
                """)
                await assert_no_prompt(guarded, state)
                checks.append("Enrollment rechecks current server " + changed_gate + " before any credential challenge or prompt")

            changed, state = await make(signed_in=True)
            await profile(changed)
            await changed.wait_for_selector("#passkeyRegister", state="visible")
            await state["cdp"].send("WebAuthn.setAutomaticPresenceSimulation", {
                "authenticatorId": state["authenticator_id"], "enabled": False,
            })
            await changed.locator("#passkeyRegister").click()
            await changed.wait_for_function("window.__passkeyCalls.create === 1")
            await changed.get_by_role("button", name="Выйти", exact=True).click()
            await assert_closed(changed)
            await changed.wait_for_timeout(100)
            assert state["registration_options"] == 1 and state["registration_verify"] == 0
            checks.append("Signout during a pending REAL virtual enrollment aborts credential creation before registration verification")

        assert not errors, errors
        assert not [fault for state in states for fault in state["faults"]]
        result.update({
            "pass": True,
            "scope": "REAL_BUNDLED_SDK_MOCK_SUPABASE_HTTP",
            "credential_ceremony": "REAL_CHROMIUM_CDP_VIRTUAL_AUTHENTICATOR" if name == "chromium" else "MOCK_API_FALLBACK_ONLY",
            "production_supabase_passkeys": "NOT_TESTED", "real_biometrics": "NOT_TESTED",
            "physical_iPhone": False, "errors": errors,
        })
    except Exception:
        result.update({"pass": False, "error": traceback.format_exc(), "errors": errors})
    finally:
        # Keep only counters and diagnostic events: never write generated keys,
        # assertion material or fixture sessions into the evidence artifact.
        result["mock_states"] = [{key: state[key] for key in (
            "events", "faults", "registration_options", "registration_verify",
            "authentication_options", "authentication_verify", "successful_assertions",
            "get_user", "profiles", "conversations", "storage_usage", "verifier_negative_checks",
            "logout_failures",
        )} for state in states]
        checkpoint = EVIDENCE / (name + "-passkey-login.json")
        checkpoint.write_text(json.dumps(result, ensure_ascii=False, indent=2))
        if browser:
            try:
                await browser.close()
            except Exception:
                result["pass"] = False
                result["cleanup_error"] = traceback.format_exc()
        if any(state["faults"] for state in states):
            result["pass"] = False
        checkpoint.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    return result


async def main():
    EVIDENCE.mkdir(exist_ok=True)
    assert (DIST / "passkey-login.js").is_file(), "Build the passkey candidate before running this test"
    results = []
    try:
        async with async_playwright() as playwright:
            for name in ("chromium", "webkit"):
                results.append(await one(getattr(playwright, name), name))
                (EVIDENCE / "passkey-login.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
    finally:
        (EVIDENCE / "passkey-login.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False))
    assert len(results) == 2 and all(result["pass"] for result in results)


if __name__ == "__main__":
    asyncio.run(main())
