"""OAuth browser contract against the REAL bundled SDK with MOCKED HTTP only.

No provider account, consent, email, production signup or physical iPhone is
tested. The mock authorizer redirects in the same tab without visiting a mail
provider. Credentials below are deliberately invalid fixtures. All other network
requests are blocked. Run against an already built apps/pablicus/dist directory.
"""
import asyncio
import base64
import hashlib
import json
import mimetypes
import tempfile
import time
import traceback
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

from playwright.async_api import async_playwright


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
EVIDENCE = ROOT / "evidence"
SITE = "https://pablicus-test.example.invalid/"
PROJECT_HOST = "ctcoqgsztdtsazdiwcmd.supabase.co"
USER_ID = "11111111-1111-4111-8111-111111111111"
OTHER_ID = "22222222-2222-4222-8222-222222222222"
CODE = "MOCK_OAUTH_CODE_NOT_A_CREDENTIAL"
UNTRUSTED_ERROR = "UNTRUSTED_PROVIDER_TEXT_<script>alert(1)</script>"
PROVIDERS = {
    "google": "Войти через Google",
    "custom:yandex": "Войти через Яндекс",
    "custom:mailru": "Войти через Mail.ru",
    "azure": "Войти через Outlook / Hotmail",
}


def b64url(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def fixture_session(provider="google", user_id=USER_ID):
    now = int(time.time())
    user = {
        "id": user_id,
        "email": "oauth-qa@example.invalid",
        "email_confirmed_at": "2026-09-08T00:00:00Z",
        "aud": "authenticated",
        "role": "authenticated",
        "app_metadata": {"provider": provider, "providers": [provider]},
        "user_metadata": {},
        "created_at": "2026-09-08T00:00:00Z",
    }
    if provider == "custom:yandex":
        user["email"] = ""
        user.pop("email_confirmed_at")
    token = ".".join([
        b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()),
        b64url(json.dumps({
            "sub": user_id, "exp": now + 3600, "iat": now,
            "aud": "authenticated", "role": "authenticated",
        }).encode()),
        "MOCK_SIGNATURE_NOT_A_CREDENTIAL",
    ])
    return {
        "access_token": token,
        "refresh_token": "MOCK_REFRESH_NOT_A_CREDENTIAL",
        "expires_in": 3600,
        "expires_at": now + 3600,
        "token_type": "bearer",
        "user": user,
    }


async def one(engine, name):
    checks, errors, contexts, directories, states = [], [], [], [], []
    result = {"engine": name, "pass": False, "checks": checks, "error": "Execution interrupted"}

    async def make(*, enabled=True, ready=True, approved=True,
                   identity_matches=True, deny=False, initial_url=SITE,
                   defer_other_profile=False, other_approved=False):
        directory = tempfile.TemporaryDirectory(prefix="pablicus-oauth-")
        directories.append(directory)
        context = await engine.launch_persistent_context(
            directory.name, headless=True,
            viewport={"width": 390, "height": 844},
            service_workers="block",
        )
        contexts.append(context)
        state = {
            "authorize": [], "exchanges": 0, "get_user": 0,
            "profiles": 0, "storage_usage": 0, "events": [], "faults": [], "challenge": None,
            "provider": "google",
            "other_profile_requests": 0,
            "other_profile_started": asyncio.Event(),
            "other_profile_repeated": asyncio.Event(),
            "other_profile_release": asyncio.Event(),
            "other_profile_finished": asyncio.Event(),
        }
        states.append(state)

        async def handle(route):
            response_attempted = False

            async def fulfill(**kwargs):
                nonlocal response_attempted
                response_attempted = True
                await route.fulfill(**kwargs)

            async def abort():
                nonlocal response_attempted
                response_attempted = True
                await route.abort()

            parsed = urlparse(route.request.url)
            query = parse_qs(parsed.query)
            headers = {
                "access-control-allow-origin": "*",
                "access-control-allow-headers": "*",
                "access-control-allow-methods": "GET,POST,OPTIONS",
            }
            try:
                if parsed.netloc == urlparse(SITE).netloc:
                    if parsed.path.rsplit("/", 1)[-1] == "auth-config.js" and enabled:
                        config = {
                            "publicSignupReady": ready,
                            "providers": {key: True for key in PROVIDERS},
                        }
                        return await fulfill(
                            status=200, content_type="application/javascript",
                            body="window.PablicusAuthConfig=" + json.dumps(config) + ";",
                        )
                    file = DIST / (parsed.path.lstrip("/") or "index.html")
                    assert file.is_relative_to(DIST)
                    if not file.is_file():
                        return await fulfill(status=404, body="Not found")
                    return await fulfill(
                        status=200,
                        content_type=mimetypes.guess_type(str(file))[0]
                        or "application/octet-stream",
                        body=file.read_bytes(),
                    )
                if parsed.netloc != PROJECT_HOST:
                    state["faults"].append("Unexpected network destination: " + parsed.netloc)
                    return await abort()
                if route.request.method == "OPTIONS":
                    return await fulfill(status=204, headers=headers)
                body = route.request.post_data_json if route.request.post_data else {}
                payload, status = {}, 200
                if parsed.path == "/auth/v1/authorize":
                    provider = query.get("provider", [None])[0]
                    assert provider in PROVIDERS, query
                    assert query.get("redirect_to") == [SITE], query
                    assert query.get("code_challenge_method", [""])[0].lower() == "s256", query
                    challenge = query.get("code_challenge", [""])[0]
                    assert len(challenge) == 43, query
                    state["challenge"] = challenge
                    state["provider"] = provider
                    state["authorize"].append(provider)
                    state["events"].append("authorize")
                    callback = {
                        "error": "access_denied",
                        "error_description": UNTRUSTED_ERROR,
                    } if deny else {"code": CODE}
                    callback_url = SITE + ("#" if deny == "fragment" else "?") + urlencode(callback)
                    return await fulfill(
                        status=200, content_type="text/html",
                        body="<!doctype html><meta charset=utf-8>"
                        "<p>Mock authorizer: no external provider login occurred.</p>"
                        "<script>location.replace(" + json.dumps(callback_url) + ");</script>",
                    )
                if parsed.path == "/auth/v1/token":
                    state["exchanges"] += 1
                    state["events"].append("exchange")
                    assert query.get("grant_type") == ["pkce"], query
                    assert body.get("auth_code") == CODE, body
                    verifier = body.get("code_verifier", "")
                    assert isinstance(verifier, str) and 43 <= len(verifier) <= 128
                    assert b64url(hashlib.sha256(verifier.encode()).digest()) == state["challenge"]
                    payload = fixture_session(state["provider"])
                elif parsed.path == "/auth/v1/user":
                    state["get_user"] += 1
                    state["events"].append("get_user")
                    assert route.request.headers.get("authorization", "").startswith("Bearer ")
                    payload = fixture_session(state["provider"])["user"]
                    if not identity_matches:
                        payload["id"] = OTHER_ID
                elif parsed.path == "/auth/v1/logout":
                    state["events"].append("logout")
                elif parsed.path == "/rest/v1/profiles":
                    state["profiles"] += 1
                    state["events"].append("profile")
                    assert state["get_user"] > 0, "Profile read preceded server identity validation"
                    profile_id = query.get("id", [""])[0].removeprefix("eq.")
                    assert profile_id == USER_ID or (defer_other_profile and profile_id == OTHER_ID), query
                    if profile_id == OTHER_ID:
                        state["other_profile_requests"] += 1
                        state["other_profile_started"].set()
                        if state["other_profile_requests"] >= 2:
                            state["other_profile_repeated"].set()
                        await state["other_profile_release"].wait()
                    payload = {
                        "id": profile_id, "username": "oauth_qa" if profile_id == USER_ID else "other_qa",
                        "display_name": "OAuth QA" if profile_id == USER_ID else "Other QA", "avatar_url": None,
                        "is_approved": approved if profile_id == USER_ID else other_approved,
                    }
                elif parsed.path == "/rest/v1/rpc/pablicus_storage_usage":
                    assert route.request.method == "POST" and body == {}
                    assert state["get_user"] > 0 and state["profiles"] > 0
                    assert approved and identity_matches
                    authorization = route.request.headers.get("authorization", "")
                    assert authorization.startswith("Bearer ")
                    claims = authorization.removeprefix("Bearer ").split(".")[1]
                    assert json.loads(base64.urlsafe_b64decode(claims + "=" * (-len(claims) % 4)))["sub"] == USER_ID
                    state["storage_usage"] += 1
                    state["events"].append("storage_usage")
                    # The isolated OAuth backend has no uploaded objects.
                    payload = [{"total_bytes": 0, "own_bytes": 0,
                                "object_count": 0, "own_object_count": 0,
                                "unknown_size_count": 0,
                                "measured_at": "2026-09-09T00:00:00Z"}]
                elif parsed.path.startswith("/rest/v1/rpc/my_conversations"):
                    payload = []
                else:
                    raise AssertionError("Unexpected mocked endpoint: " + parsed.path)
                await fulfill(
                    status=status, headers=headers, content_type="application/json",
                    body=json.dumps(payload),
                )
                if parsed.path == "/rest/v1/profiles" and payload.get("id") == OTHER_ID:
                    state["other_profile_finished"].set()
            except Exception:
                state["faults"].append(traceback.format_exc())
                # A failed fulfill can already consume the route. Never try to
                # handle it twice or replace the original failure with cleanup.
                if not response_attempted:
                    try:
                        await fulfill(
                            status=500, headers=headers, content_type="application/json",
                            body=json.dumps({"error": "mock_contract_failed"}),
                        )
                    except Exception:
                        state["faults"].append("Error returning mock failure:\n" + traceback.format_exc())

        await context.route("**/*", handle)
        page = context.pages[0] if context.pages else await context.new_page()
        page.set_default_timeout(12000)
        page.on("pageerror", lambda error: errors.append(str(error)))
        await page.goto(initial_url, wait_until="domcontentloaded")
        await page.wait_for_function("typeof window.PablicusDebug !== 'undefined'")
        return page, state

    async def assert_closed(page):
        await page.wait_for_selector("#loginPane", state="visible")
        assert not await page.locator("#workspace").is_visible()
        assert await page.evaluate("PablicusDebug.user") is None

    async def assert_error(page):
        await page.wait_for_function("document.getElementById('loginError')?.textContent.trim().length > 0")
        await assert_closed(page)
        assert not urlparse(page.url).query
        assert not urlparse(page.url).fragment
        assert CODE not in await page.evaluate("Object.values(localStorage).join(' ')")
        assert UNTRUSTED_ERROR not in await page.locator("body").inner_text()

    async def broadcast_auth(page, event, session):
        # The pinned SDK creates BroadcastChannel(storageKey), posts
        # {event, session}, and forwards received values to onAuthStateChange.
        # Model another tab persisting its SDK session and emitting that event.
        await page.evaluate("""({event, session}) => {
            const key = 'sb-ctcoqgsztdtsazdiwcmd-auth-token';
            if (session) localStorage.setItem(key, JSON.stringify(session));
            else localStorage.removeItem(key);
            const channel = new BroadcastChannel(key);
            channel.postMessage({event, session});
            channel.close();
        }""", {"event": event, "session": session})

    async def start_identity_change(*, next_approved=False):
        page, state = await make(defer_other_profile=True, other_approved=next_approved)
        await page.get_by_role("button", name=PROVIDERS["google"], exact=True).click()
        await page.wait_for_selector("#workspace", state="visible")
        await page.locator('#mainNav [data-page="profile"]').click()
        await page.wait_for_selector("#screenContent .profileCard", state="visible")
        assert await page.locator("#screenContent .profileCard > h2").inner_text() == "OAuth QA"
        await broadcast_auth(page, "SIGNED_IN", fixture_session(user_id=OTHER_ID))
        await asyncio.wait_for(state["other_profile_started"].wait(), timeout=12)
        await page.wait_for_selector("#workspace", state="hidden")
        assert not await page.locator("#screenContent .profileCard").is_visible()
        await page.evaluate("""() => {
            window.oauthRaceExposedWorkspace = false;
            const workspace = document.getElementById('workspace');
            new MutationObserver(() => {
                if (!workspace.hidden) window.oauthRaceExposedWorkspace = true;
            }).observe(workspace, {attributes: true, attributeFilter: ['hidden']});
        }""")
        return page, state

    try:
        disabled, state = await make(enabled=False)
        await assert_closed(disabled)
        assert not await disabled.locator("#oauthLogin").is_visible()
        assert state["authorize"] == [] and state["exchanges"] == 0
        checks.append("Published default config hides unavailable OAuth and makes no authorization request")

        unready, state = await make(ready=False)
        await assert_closed(unready)
        assert not await unready.locator("#oauthLogin").is_visible()
        assert state["authorize"] == [] and state["exchanges"] == 0
        checks.append("Provider flags alone cannot enable login before public signup readiness")

        for provider, label in PROVIDERS.items():
            page, state = await make()
            await page.wait_for_selector("#oauthLogin", state="visible")
            for expected_label in PROVIDERS.values():
                assert await page.locator("#oauthProviders").get_by_role(
                    "button", name=expected_label, exact=True,
                ).count() == 1
            assert await page.evaluate(
                "document.documentElement.scrollWidth <= window.innerWidth"
            ), "Mobile provider list has horizontal overflow"
            if provider == "google":
                await page.screenshot(path=str(EVIDENCE / (name + "-oauth-providers-MOCK.png")))
            initial_pages = len(page.context.pages)
            await page.get_by_role("button", name=label, exact=True).click()
            await page.wait_for_selector("#workspace", state="visible")
            assert len(page.context.pages) == initial_pages, "OAuth unexpectedly opened a popup"
            assert page.url == SITE
            assert await page.evaluate("PablicusDebug.user") == USER_ID
            assert state["authorize"] == [provider] and state["exchanges"] == 1
            assert state["get_user"] >= 1
            assert state["events"].index("get_user") < state["events"].index("profile")
            assert CODE not in await page.evaluate("Object.values(localStorage).join(' ')")
            await page.reload()
            await page.wait_for_selector("#workspace", state="visible")
            assert state["exchanges"] == 1 and state["authorize"] == [provider]
            checks.append(
                provider + ": SDK S256 challenge matches exchanged verifier; same tab, "
                "server identity checked before profile, callback scrubbed, session restores"
            )

        for denial_format in ("query", "fragment"):
            denied, state = await make(deny=denial_format)
            await denied.get_by_role("button", name=PROVIDERS["google"], exact=True).click()
            await assert_error(denied)
            assert state["exchanges"] == 0 and state["profiles"] == 0
            checks.append(
                "Provider denial in " + denial_format
                + " is scrubbed, shows safe error, and never creates a session"
            )

        implicit, state = await make(initial_url=SITE + "#" + urlencode({
            "access_token": fixture_session()["access_token"],
            "refresh_token": fixture_session()["refresh_token"],
            "token_type": "bearer", "expires_in": "3600",
        }))
        await assert_error(implicit)
        assert state["exchanges"] == 0 and state["get_user"] == 0 and state["profiles"] == 0
        assert await implicit.evaluate(
            "localStorage.getItem('sb-ctcoqgsztdtsazdiwcmd-auth-token')"
        ) is None
        checks.append("Implicit access-token fragments are scrubbed and cannot bypass the PKCE flow")

        foreign, state = await make(initial_url=SITE + "?code=" + CODE)
        await assert_error(foreign)
        assert state["exchanges"] == 0 and state["profiles"] == 0
        checks.append("Callback in a separate browser store fails before exchange when verifier is missing")

        unapproved, state = await make(approved=False)
        await unapproved.get_by_role("button", name=PROVIDERS["google"], exact=True).click()
        await assert_error(unapproved)
        assert state["exchanges"] == 1 and state["profiles"] >= 1
        checks.append("Valid OAuth session does not bypass the existing profile approval gate")

        mismatch, state = await make(identity_matches=False)
        await mismatch.get_by_role("button", name=PROVIDERS["google"], exact=True).click()
        await assert_error(mismatch)
        assert state["exchanges"] == 1 and state["profiles"] == 0
        assert "logout" in state["events"]
        assert await mismatch.evaluate(
            "localStorage.getItem('sb-ctcoqgsztdtsazdiwcmd-auth-token')"
        ) is None
        checks.append("Server identity mismatch fails closed before any profile or conversation fetch")

        changed, state = await start_identity_change()
        await broadcast_auth(changed, "SIGNED_IN", fixture_session(user_id=OTHER_ID))
        await asyncio.wait_for(state["other_profile_repeated"].wait(), timeout=12)
        state["other_profile_release"].set()
        await assert_error(changed)
        assert state["other_profile_requests"] == 2
        assert not await changed.evaluate("window.oauthRaceExposedWorkspace")
        assert not await changed.locator("#screenContent .profileCard").is_visible()
        checks.append(
            "A to unapproved B with duplicate SDK broadcast hides A immediately and never admits B "
            "while two delayed profile responses settle"
        )

        signed_out, state = await start_identity_change(next_approved=True)
        await broadcast_auth(signed_out, "SIGNED_OUT", None)
        await signed_out.wait_for_function("PablicusDebug.user == null")
        await assert_closed(signed_out)
        async with signed_out.expect_response(
            lambda response: urlparse(response.url).path == "/rest/v1/profiles"
            and parse_qs(urlparse(response.url).query).get("id") == ["eq." + OTHER_ID]
        ) as response_info:
            state["other_profile_release"].set()
        await (await response_info.value).finished()
        # Allow the delayed fetch continuation and queued auth callback to run;
        # no production operation or arbitrary long wait is involved.
        await signed_out.wait_for_timeout(100)
        await assert_closed(signed_out)
        assert not await signed_out.evaluate("window.oauthRaceExposedWorkspace")
        assert not await signed_out.locator("#screenContent .profileCard").is_visible()
        checks.append("SIGNED_OUT invalidates a pending approved B profile response and prevents stale workspace restoration")

        faults = [fault for state in states for fault in state["faults"]]
        assert not faults, faults
        assert not errors, errors
        result = {
            "engine": name, "pass": True, "checks": checks,
            "scope": "REAL_BUNDLED_SDK_MOCK_AUTH_HTTP_SEPARATE_BROWSER_STORES",
            "provider_ui_screenshot": name + "-oauth-providers-MOCK.png",
            "real_provider_authorization": "NOT_TESTED",
            "real_public_signup": "NOT_TESTED",
            "physical_iPhone": False,
            "errors": errors,
        }
    except Exception:
        result = {
            "engine": name, "pass": False, "checks": checks,
            "error": traceback.format_exc(), "errors": errors,
            "mock_faults": [fault for state in states for fault in state["faults"]],
        }
    finally:
        result["mock_states"] = [{
            key: state[key] for key in ("authorize", "exchanges", "get_user", "profiles", "storage_usage", "events", "faults", "other_profile_requests")
        } for state in states]
        result["last_urls"] = [page.url for context in contexts for page in context.pages]
        checkpoint = EVIDENCE / (name + "-oauth-login.json")
        # Preserve the test outcome before cleanup can fail or hang.
        checkpoint.write_text(json.dumps(result, ensure_ascii=False, indent=2))
        cleanup_errors = []
        for state in states:
            state["other_profile_release"].set()
        for context in contexts:
            try:
                await context.close()
            except Exception:
                cleanup_errors.append(traceback.format_exc())
        for directory in directories:
            try:
                directory.cleanup()
            except Exception:
                cleanup_errors.append(traceback.format_exc())
        if cleanup_errors:
            result["pass"] = False
            result["cleanup_errors"] = cleanup_errors
        late_faults = [fault for state in states for fault in state["faults"]]
        if late_faults:
            result["pass"] = False
            result["mock_faults"] = late_faults
        checkpoint.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    return result


async def main():
    EVIDENCE.mkdir(exist_ok=True)
    assert (DIST / "auth-config.js").is_file(), "Build the OAuth candidate before running this test"
    results = []
    try:
        async with async_playwright() as playwright:
            for name in ("chromium", "webkit"):
                results.append(await one(getattr(playwright, name), name))
                (EVIDENCE / "oauth-login.json").write_text(
                    json.dumps(results, ensure_ascii=False, indent=2)
                )
    finally:
        (EVIDENCE / "oauth-login.json").write_text(
            json.dumps(results, ensure_ascii=False, indent=2)
        )
    print(json.dumps(results, ensure_ascii=False))
    assert all(result["pass"] for result in results)


if __name__ == "__main__":
    asyncio.run(main())
