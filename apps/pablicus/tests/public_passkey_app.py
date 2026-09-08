"""Public-key entry in the REAL built app/SDK with MOCKED Auth HTTP.

All network requests are intercepted. This covers button routing, PKCE,
callback restoration and account admission. It creates no real account or
passkey and does not test the deployed provider, biometrics or an iPhone.
The separate public_passkey_page.py covers actual virtual WebAuthn bytes.
"""
import asyncio
import hashlib
import json
import mimetypes
import traceback
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

from playwright.async_api import async_playwright, expect
from oauth_login import b64url, fixture_session


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
EVIDENCE = ROOT / "evidence"
ORIGIN = "https://matveyryabokon30-crypto.github.io"
SITE = ORIGIN + "/vision-talk/pablicus/"
PROJECT_HOST = "ctcoqgsztdtsazdiwcmd.supabase.co"
PROVIDER = "custom:pablicus-passkey"
USER_ID = "11111111-1111-4111-8111-111111111111"
OTHER_ID = "22222222-2222-4222-8222-222222222222"
SUBJECT_ID = "33333333-3333-4333-8333-333333333333"
CODE = "MOCK_PUBLIC_PASSKEY_CODE_NOT_A_CREDENTIAL"
STORAGE = "sb-ctcoqgsztdtsazdiwcmd-auth-token"


def session_for(kind):
    session = fixture_session(PROVIDER, USER_ID)
    user = session["user"]
    subject = SUBJECT_ID if kind == "new" else "native:" + (
        OTHER_ID if kind == "mismatch" else USER_ID)
    user["identities"] = [{
        "provider": PROVIDER, "id": subject,
        "identity_id": "44444444-4444-4444-8444-444444444444",
        "identity_data": {"sub": subject}, "user_id": USER_ID,
    }]
    if kind == "new":
        user["email"] = ""
        user.pop("email_confirmed_at", None)
    return session


async def one(engine, engine_name):
    contexts, states, errors, checks = [], [], [], []
    result = {"engine": engine_name, "pass": False, "checks": checks}
    browser = None
    try:
        browser = await engine.launch()

        async def make(kind, approved=True):
            context = await browser.new_context(
                viewport={"width": 390, "height": 844}, service_workers="block")
            contexts.append(context)
            state = {"kind": kind, "authorize": [], "exchanges": 0,
                     "get_user": 0, "profiles": 0, "conversations": 0,
                     "events": [], "faults": [], "challenge": None}
            states.append(state)
            await context.add_init_script("""(() => {
              window.__unexpectedCeremonyCalls = 0;
              Object.defineProperty(window, 'PublicKeyCredential', {
                value:class PublicKeyCredential {}, configurable:true
              });
              const unexpected = async () => {
                window.__unexpectedCeremonyCalls++;
                throw new Error('Direct native ceremony must not run in public OAuth entry');
              };
              Object.defineProperty(navigator, 'credentials', {
                value:{get:unexpected, create:unexpected}, configurable:true
              });
            })();""")
            cors = {"access-control-allow-origin": ORIGIN,
                    "access-control-allow-headers": "*",
                    "access-control-allow-methods": "GET,POST,OPTIONS"}

            async def handle(route):
                responded = False

                async def fulfill(**kwargs):
                    nonlocal responded
                    responded = True
                    await route.fulfill(**kwargs)

                try:
                    request = route.request
                    parsed = urlparse(request.url)
                    query = parse_qs(parsed.query)
                    if parsed.scheme + "://" + parsed.netloc == ORIGIN:
                        assert parsed.path.startswith("/vision-talk/pablicus/")
                        relative = parsed.path.removeprefix("/vision-talk/pablicus/")
                        if relative == "auth-config.js":
                            config = {
                                "passkeys": {"enabled": True, "rpId": urlparse(ORIGIN).hostname,
                                             "origin": ORIGIN},
                                "publicPasskey": {"enabled": True, "origin": ORIGIN},
                                "publicSignupReady": False,
                                "providers": {"google": False, "custom:yandex": False,
                                              "custom:mailru": False, "azure": False},
                            }
                            return await fulfill(status=200, content_type="application/javascript",
                                body="window.PablicusAuthConfig=" + json.dumps(config) + ";")
                        file = (DIST / (relative or "index.html")).resolve()
                        assert file.is_relative_to(DIST.resolve())
                        return await fulfill(status=200 if file.is_file() else 404,
                            content_type=mimetypes.guess_type(str(file))[0] or "application/octet-stream",
                            body=file.read_bytes() if file.is_file() else b"Not found")
                    assert parsed.netloc == PROJECT_HOST, "Unexpected destination: " + parsed.netloc
                    if request.method == "OPTIONS":
                        return await fulfill(status=204, headers=cors)
                    body = request.post_data_json if request.post_data else {}
                    if parsed.path == "/auth/v1/authorize":
                        assert request.method == "GET"
                        assert query.get("provider") == [PROVIDER]
                        assert query.get("redirect_to") == [SITE]
                        assert query.get("code_challenge_method", [""])[0].lower() == "s256"
                        state["challenge"] = query.get("code_challenge", [""])[0]
                        assert len(state["challenge"]) == 43
                        assert not {"password", "email", "phone", "client_secret"}.intersection(query)
                        state["authorize"].append(PROVIDER)
                        state["events"].append("authorize")
                        # Only the authorizer response is simulated. The SDK
                        # and built app execute the real callback restoration.
                        return await fulfill(status=200, content_type="text/html",
                            body="<!doctype html><p>MOCK public passkey authorization</p>"
                            "<script>location.replace(" + json.dumps(SITE + "?" + urlencode({"code": CODE})) + ");</script>")
                    if parsed.path == "/auth/v1/token":
                        assert request.method == "POST"
                        assert query.get("grant_type") == ["pkce"]
                        assert body.get("auth_code") == CODE
                        verifier = body.get("code_verifier", "")
                        assert 43 <= len(verifier) <= 128
                        assert b64url(hashlib.sha256(verifier.encode()).digest()) == state["challenge"]
                        state["exchanges"] += 1
                        state["events"].append("exchange")
                        payload = session_for(kind)
                    elif parsed.path == "/auth/v1/user":
                        assert request.headers.get("authorization", "").startswith("Bearer ")
                        state["get_user"] += 1
                        state["events"].append("get_user")
                        payload = session_for(kind)["user"]
                    elif parsed.path == "/auth/v1/logout":
                        state["events"].append("logout")
                        payload = {}
                    elif parsed.path == "/rest/v1/profiles":
                        assert state["get_user"] > 0
                        assert query.get("id") == ["eq." + USER_ID]
                        state["profiles"] += 1
                        state["events"].append("profile")
                        payload = {"id": USER_ID, "username": "public_key_qa",
                                   "display_name": "Public Key QA", "avatar_url": None,
                                   "is_approved": approved}
                    elif parsed.path.startswith("/rest/v1/rpc/my_conversations"):
                        assert state["profiles"] > 0 and approved
                        state["conversations"] += 1
                        payload = []
                    else:
                        raise AssertionError("Unexpected mocked endpoint: " + parsed.path)
                    await fulfill(status=200, headers=cors, content_type="application/json",
                                  body=json.dumps(payload))
                except Exception:
                    state["faults"].append(traceback.format_exc())
                    if not responded:
                        await fulfill(status=500, headers=cors, content_type="application/json",
                                      body='{"error":"mock_contract_failed"}')

            await context.route("**/*", handle)
            page = await context.new_page()
            page.set_default_timeout(12000)
            page.on("pageerror", lambda error: errors.append(str(error)))
            await page.goto(SITE, wait_until="domcontentloaded")
            await expect(page.locator("#passkeySignIn")).to_be_visible()
            await expect(page.locator("#passkeySignIn")).to_be_enabled()
            await expect(page.locator("#oauthLogin")).to_be_hidden()
            assert state["authorize"] == [] and state["exchanges"] == 0
            assert await page.evaluate("window.__unexpectedCeremonyCalls") == 0
            return page, state

        for kind in ("new", "native"):
            page, state = await make(kind)
            await page.locator("#passkeySignIn").click()
            await expect(page.locator("#workspace")).to_be_visible()
            await expect(page.locator("#loginPane")).to_be_hidden()
            assert page.url == SITE and len(page.context.pages) == 1
            assert await page.evaluate("PablicusDebug.user") == USER_ID
            assert state["authorize"] == [PROVIDER] and state["exchanges"] == 1
            assert state["events"].index("get_user") < state["events"].index("profile")
            assert CODE not in await page.evaluate("Object.values(localStorage).join(' ')")
            assert await page.evaluate("window.__unexpectedCeremonyCalls") == 0
            stored = await page.evaluate("key => JSON.parse(localStorage.getItem(key))", STORAGE)
            assert stored["user"]["identities"][0]["identity_data"]["sub"] == (
                SUBJECT_ID if kind == "new" else "native:" + USER_ID)
            if kind == "new":
                assert not stored["user"].get("email_confirmed_at") and not stored["user"].get("email")
            await page.reload(wait_until="domcontentloaded")
            await expect(page.locator("#workspace")).to_be_visible()
            assert await page.evaluate("PablicusDebug.user") == USER_ID
            assert state["exchanges"] == 1 and state["authorize"] == [PROVIDER]
            checks.append(kind + ": public button uses same-tab custom OAuth with real SDK S256; "
                          "mocked server identity is admitted to its own UID and session restores")

        mismatch, state = await make("mismatch")
        await mismatch.locator("#passkeySignIn").click()
        await expect(mismatch.locator("#loginError")).to_contain_text("Ключ не удалось связать")
        await expect(mismatch.locator("#workspace")).to_be_hidden()
        await expect(mismatch.locator("#loginPane")).to_be_visible()
        assert await mismatch.evaluate("PablicusDebug.user") is None
        assert state["exchanges"] == 1 and state["get_user"] >= 1
        assert state["profiles"] == 0 and state["conversations"] == 0
        assert mismatch.url == SITE
        checks.append("Native subject with a different UID is denied before profile or conversation reads")

        denied, state = await make("new", approved=False)
        await denied.locator("#passkeySignIn").click()
        await expect(denied.locator("#loginError")).to_contain_text("Аккаунт ещё не одобрен")
        await expect(denied.locator("#workspace")).to_be_hidden()
        assert await denied.evaluate("PablicusDebug.user") is None
        assert state["profiles"] >= 1 and state["conversations"] == 0
        checks.append("Public-key identity does not bypass existing server profile approval")

        assert not errors, errors
        assert not [fault for state in states for fault in state["faults"]]
        result.update({"pass": True, "scope": "REAL_BUILT_APP_AND_SDK_MOCK_AUTH_HTTP",
                       "real_provider_authorization": "NOT_TESTED",
                       "real_public_signup": "NOT_TESTED", "physical_iPhone": False})
    except Exception:
        result["error"] = traceback.format_exc()
    finally:
        result["states"] = states
        result["errors"] = errors
        for context in contexts:
            try:
                await context.close()
            except Exception:
                result["pass"] = False
                result.setdefault("cleanup_errors", []).append(traceback.format_exc())
        if browser:
            await browser.close()
        (EVIDENCE / (engine_name + "-public-passkey-app-MOCK.json")).write_text(
            json.dumps(result, ensure_ascii=False, indent=2))
    return result


async def main():
    EVIDENCE.mkdir(exist_ok=True)
    assert (DIST / "public-passkey.js").is_file(), "Build the public passkey candidate first"
    results = []
    async with async_playwright() as playwright:
        for name in ("chromium", "webkit"):
            results.append(await one(getattr(playwright, name), name))
            (EVIDENCE / "public-passkey-app-MOCK.json").write_text(
                json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False, indent=2))
    assert all(result["pass"] for result in results), "Public passkey app contract failed"


if __name__ == "__main__":
    asyncio.run(main())
