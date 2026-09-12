"""Completed real route transitions and unchanged same-screen resource ownership."""
import asyncio
import time

from integration_case import check, A, C1, BOT, RESULT, save


def lasting_resources(snapshot):
    # No source/type is excluded. Completed timeout/rAF work is allowed to settle;
    # surviving SDK heartbeat timeouts remain visible and must match the baseline.
    return {key: snapshot[key] for key in [
        'listeners', 'listener_sources', 'detached_listeners',
        'observers', 'observer_sources', 'controller', 'channels',
        'timers', 'timer_sources', 'frames', 'media',
    ]}


async def run(a):
    RESULT['transitions'] = []
    RESULT['resource_snapshots'] = {'before': None, 'per_cycle': [], 'settling': []}
    RESULT['resource_scope'] = {
        'APP_CONSTANT': 'Warm SDK/client/controller and top-level module handlers remain present.',
        'SCREEN_SCOPED': 'Listener/observer source and type, controller handlers/subscriptions, channels, message list and media ownership.',
        'TRANSIENT_OPERATION': 'Native timers/rAF and RPCs continue normally. At each chats-home checkpoint, collect bounded GC first, then sample for up to three seconds; require two consecutive identical complete resource projections, zero rAF and no unfinished boundary calls. Surviving timeout sources are compared exactly with the warm baseline, not excluded. Failure to obtain observations is ERROR/TIMEOUT, not evidence of a product leak.',
        'gc_limit_ms': 10000,
        'settling_limit_ms': 3000,
        'generation': 'Auxiliary evidence only; never counted as completed transitions.',
    }
    save()
    await a.login()

    async def transition(action_id, action, screen, section, selector, counted):
        record = {'action_id': action_id, 'counted': False, 'intended_counted': counted,
                  'expected': {'screen': screen, 'section': section,
                               'conversationId': C1 if screen in ['conversation', 'canvas'] else None,
                               'resourceId': BOT if screen == 'scenario' else None,
                               'visible_selector': selector}, 'completed': False}
        RESULT['transitions'].append(record)
        save()
        before = await a.state()
        offset = await a.page.evaluate('__integration.controllerStats.navigations.length')
        await action()
        await a.page.wait_for_function("""offset => {
            const calls = __integration.controllerStats.navigations.slice(offset);
            return calls.length > 0 && calls.every(call => call.status !== 'pending');
        }""", arg=offset, timeout=8000)
        await a.page.locator(selector).first.wait_for(state='visible', timeout=8000)
        calls = await a.page.evaluate('offset => __integration.controllerStats.navigations.slice(offset)', offset)
        state = await a.state()
        route = state['route']
        resources = await a.page.evaluate('({list:PablicusChat.snapshot.counters,appInert:document.querySelector("#app").inert,rows:document.querySelectorAll("#canvas .row").length})')
        visible = {name: await a.page.locator(selector).is_visible()
                   for name, selector in [('home', '#home'), ('app', '#app'), ('canvas', '#chatCanvasPanel')]}
        target = record['expected']
        ok = (len(calls) == 1 and calls[0]['status'] == 'fulfilled' and calls[0].get('result') is True
              and all(route.get(key) == target[key] for key in ['screen', 'section', 'conversationId', 'resourceId'])
              and state['uid'] == A and route['sessionUserId'] == A
              and route['sessionGeneration'] == before['route']['sessionGeneration']
              and state['selected'] == [section])
        if screen in ['conversation', 'canvas']:
            ok = (ok and visible['app'] and not visible['home'] and not resources['appInert']
                  and visible['canvas'] == (screen == 'canvas') and state['list'] and state['ready']
                  and state['scope'] == {'user': A, 'chat': C1} and state['current'] == C1
                  and resources['list']['active_lists'] == 1
                  and (screen == 'canvas' or resources['rows'] > 0))
        else:
            ok = (ok and visible['home'] and not visible['app'] and not state['list']
                  and state['current'] is None and resources['list']['active_lists'] == 0)
        record.update(completed=ok, counted=bool(ok and counted), navigation_calls=calls,
                      observed_state=state, visible=visible, resources=resources,
                      generation_before=before['route']['generation'], generation_after=route['generation'])
        save()
        check('1C-TRANSITION-'+action_id, ok, record)

    async def cycle(label, counted):
        actions = [
            ('conversation', a.conversation, 'conversation', 'chats', '#vp'),
            ('canvas', a.canvas, 'canvas', 'chats', '.pablicusChatCanvas[data-state="ready"]'),
            ('return', lambda: a.page.locator('#conversationTab').click(), 'conversation', 'chats', '#vp'),
            ('back', a.back, 'home', 'chats', f'.chatCard[data-conversation-id="{C1}"]'),
            ('bots', a.bots, 'bots', 'bots', f'.botCard[data-bot-id="{BOT}"]'),
            ('scenario', a.scenario, 'scenario', 'bots', '.scenarioList'),
            ('tasks', lambda: a.nav('tasks'), 'home', 'tasks', '.pablicusTasksHome[data-state="ready"]'),
            ('profile', lambda: a.nav('profile'), 'home', 'profile', '.profileCard'),
            ('chats', lambda: a.nav('chats'), 'home', 'chats', f'.chatCard[data-conversation-id="{C1}"]'),
        ]
        for index, (name, action, screen, section, selector) in enumerate(actions, 1):
            await transition(f'{label}-{index:02d}-{name}', action, screen, section, selector, counted)

    async def settled(label):
        samples = []
        entry = {'label': label, 'gc': {'status': 'RUNNING', 'limit_ms': 10000},
                 'samples': samples, 'settled': False, 'status': 'RUNNING'}
        RESULT['resource_snapshots']['settling'].append(entry)
        save()
        gc_started = time.monotonic()
        async def collect():
            cd = await a.ctx.new_cdp_session(a.page)
            try:
                await cd.send('HeapProfiler.collectGarbage')
            finally:
                await cd.detach()
        try:
            await asyncio.wait_for(collect(), 10)
            entry['gc']['status'] = 'PASS'
        except BaseException as exc:
            entry['gc'].update(status='TIMEOUT' if isinstance(exc, asyncio.TimeoutError) else 'ERROR',
                               error=str(exc), elapsed_ms=round((time.monotonic()-gc_started)*1000))
            entry['status'] = entry['gc']['status']
            save()
            raise
        entry['gc']['elapsed_ms'] = round((time.monotonic()-gc_started)*1000)
        save()
        started = time.monotonic()
        async def observe(awaitable, remaining):
            try:
                return await asyncio.wait_for(awaitable, remaining)
            except BaseException as exc:
                entry.update(status='TIMEOUT' if isinstance(exc, asyncio.TimeoutError) else 'ERROR',
                             observation_error=str(exc))
                save()
                raise
        for _ in range(10):
            remaining = 3-(time.monotonic()-started)
            if remaining <= 0:
                break
            snapshot = await observe(a.page.evaluate('__integration.snapshot()'), remaining)
            pending = [call for call in a.net.calls if 'status' not in call]
            samples.append({'elapsed_ms': round((time.monotonic()-started)*1000),
                            'resources': snapshot, 'pending_network': pending})
            if (len(samples) > 1 and not pending and snapshot['frames'] == 0
                    and lasting_resources(samples[-2]['resources']) == lasting_resources(snapshot)):
                entry['settled'] = True
                break
            remaining = 3-(time.monotonic()-started)
            if remaining <= 0:
                break
            await observe(a.delay(min(250, remaining*1000)), remaining)
        entry['status'] = 'PASS' if entry['settled'] else 'ERROR'
        save()
        if not entry['settled']:
            RESULT.setdefault('observation_errors', []).append({
                'name': '1C-RESOURCES-SETTLED-'+label,
                'reason': 'RESOURCE_OBSERVATION_NOT_SETTLED', 'actual': entry,
            })
            save()
            raise RuntimeError('RESOURCE_OBSERVATION_NOT_SETTLED '+label)
        check('1C-RESOURCES-SETTLED-'+label, True, entry)
        return samples[-1]['resources']

    # Warm the same nine routes once; no warm transition contributes to the 50.
    await cycle('warm', False)
    before = await settled('warm-home')
    RESULT['resource_snapshots']['before'] = before
    generation_before = (await a.state())['route']['generation']
    snapshots = RESULT['resource_snapshots']['per_cycle']
    for index in range(1, 7):
        await cycle(f'cycle-{index}', True)
        snapshots.append(await settled(f'cycle-{index}-home'))
        save()
    after = snapshots[-1]
    completed = [record for record in RESULT['transitions'] if record['counted']]
    check('1C-50-TRANSITIONS', len(completed) >= 50, {
        'completed_validated_transitions': len(completed), 'cycles': 6,
        'action_ids': [record['action_id'] for record in completed],
        'generation_delta_auxiliary': (await a.state())['route']['generation']-generation_before,
        'excluded_warm_transitions': 9,
    })
    projection = lasting_resources(before)
    differences = [{'cycle': index, 'fields': {
        key: {'before': projection[key], 'after': lasting_resources(snapshot)[key]}
        for key in projection if projection[key] != lasting_resources(snapshot)[key]
    }} for index, snapshot in enumerate(snapshots, 1)]
    equal = (all(not row['fields'] for row in differences)
             and before['list']['active_lists'] == 0
             and all(snapshot['list']['active_lists'] == 0 for snapshot in snapshots))
    check('1C-NO-RESOURCE-ACCUMULATION', equal, {
        'before': before, 'after': after, 'per_cycle_differences': differences,
        'scope': RESULT['resource_scope'],
    })
    offset = await a.page.evaluate('__integration.controllerStats.navigations.length')
    await transition('single-event-tasks', lambda: a.nav('tasks'), 'home', 'tasks',
                     '.pablicusTasksHome[data-state="ready"]', False)
    calls = await a.page.evaluate('offset => __integration.controllerStats.navigations.slice(offset)', offset)
    check('1C-ONE-EVENT-ONE-NAVIGATION', len(calls) == 1 and calls[0].get('result') is True, calls)
