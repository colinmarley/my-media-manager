"""
Issue #34 QA probe: the startup / auto-retry wiring that AC1 and AC7 depend on.

AC1 says the grouped listing shows items detected *before the backend started*, and AC7 says an
`ignored` item is never picked up again by the auto-processor. Both depend on two lines of wiring
in `backend/main.py` that no service-level test can see:

  * `lifespan` has to index the persisted rows (`load_persisted_paths()`) *before* the watcher
    starts scanning. Without it the in-memory queue starts empty, a re-detected file gets a second
    row, and an ignored file comes back as pending.
  * the idle auto-retry block has to ask the queue service for its candidates
    (`get_retry_candidate_ids(now=...)`) instead of filtering `items_by_id` by status inline —
    that is where "terminal statuses are never auto-retried" lives in the product.

On `refactor` neither call exists (the retry block hand-filters `queue_service.items_by_id.values()`
and nothing indexes persisted rows at startup), so these probes fail there and pass here.
"""

import ast
from pathlib import Path

MAIN_PY = Path(__file__).resolve().parents[1] / "main.py"
TREE = ast.parse(MAIN_PY.read_text())


def _function(name: str):
    for node in ast.walk(TREE):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    raise AssertionError(f'{MAIN_PY} has no "{name}" function')


def _calls(node, attribute: str):
    """Every `something.<attribute>(...)` call inside `node`, innermost expression first."""
    found = []
    for call in ast.walk(node):
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == attribute:
            found.append(call)
    return found


def _parents(node):
    parents = {}
    for parent in ast.walk(node):
        for child in ast.iter_child_nodes(parent):
            parents[child] = parent
    return parents


def _chain(parents, node):
    current = parents.get(node)
    while current is not None:
        yield current
        current = parents.get(current)


def _inline_status_comparisons(node):
    """String literals compared against `item.status` inside `node`."""
    literals = []
    for compare in ast.walk(node):
        if not isinstance(compare, ast.Compare) or not isinstance(compare.left, ast.Attribute):
            continue
        if compare.left.attr != 'status':
            continue
        for operator, comparator in zip(compare.ops, compare.comparators):
            if isinstance(operator, ast.Eq) and isinstance(comparator, ast.Constant):
                literals.append(comparator.value)
    return literals


def test_startup_indexes_the_persisted_queue_before_the_watcher_scans():
    """AC1: a backlog written before this process started must be in the path index already."""
    lifespan = _function('lifespan')

    index_calls = _calls(lifespan, 'load_persisted_paths')
    assert len(index_calls) == 1, 'lifespan must index persisted rows exactly once at startup'
    index_call = index_calls[0]

    # Awaited, or the watcher would race an unfinished query for the path index.
    parents = _parents(lifespan)
    assert isinstance(parents.get(index_call), ast.Await), 'load_persisted_paths() must be awaited'

    # Before any watcher starts scanning files, otherwise the first scan re-queues what it finds.
    watcher_starts = _calls(lifespan, 'start_watching')
    assert watcher_starts, 'lifespan is expected to start the ingress watcher'
    assert index_call.lineno < min(call.lineno for call in watcher_starts), (
        f'load_persisted_paths() (line {index_call.lineno}) must run before the watcher starts '
        f'(line {min(call.lineno for call in watcher_starts)})'
    )

    # A queue table that is unreachable at boot is a degraded start, not a crash loop.
    enclosing_try = next((p for p in _chain(parents, index_call) if isinstance(p, ast.Try)), None)
    assert enclosing_try is not None, 'load_persisted_paths() must be guarded so startup survives it'
    assert any(
        handler.type is None or getattr(handler.type, 'id', None) == 'Exception'
        for handler in enclosing_try.handlers
    ), 'the guard has to catch a broad database failure'


def test_the_queue_service_is_wired_to_the_session_factory():
    """Hydration, group listings and bulk selectors are dead weight without a db_session_factory."""
    lifespan = _function('lifespan')

    constructions = [call for call in ast.walk(lifespan)
                     if isinstance(call, ast.Call) and getattr(call.func, 'id', None) == 'IngressQueueService']
    assert len(constructions) == 1, 'lifespan must build the ingress queue exactly once'
    keywords = {keyword.arg for keyword in constructions[0].keywords}
    assert 'db_session_factory' in keywords, (
        'IngressQueueService must be given db_session_factory: DB-only backlog items stay '
        'unactionable (no hydration, no persisted-path index) without it'
    )


def test_the_idle_auto_retry_block_asks_the_queue_service_for_candidates():
    """AC7: the auto-retry loop has to use the helper that excludes terminal statuses."""
    auto_processor = _function('run_ingress_auto_processor')

    candidates = _calls(auto_processor, 'get_retry_candidate_ids')
    assert len(candidates) == 1, 'the auto-retry block must ask get_retry_candidate_ids() who is eligible'
    assert any(keyword.arg == 'now' for keyword in candidates[0].keywords), (
        'the candidate query needs the clock passed in so the back-off window stays in one place'
    )

    retries = _calls(auto_processor, 'retry_item')
    assert retries, 'the auto-retry block must retry the candidates it was handed'

    # The old loop filtered items_by_id by status inline, which ignored terminal statuses and
    # everything that only exists in Postgres. That filter must not come back.
    assert not _calls(auto_processor, 'get_queue_items'), (
        'the auto-retry block must not hand-pick items from the in-memory queue: terminal-status '
        'exclusion lives in get_retry_candidate_ids()'
    )
    assert 'failed' not in _inline_status_comparisons(auto_processor), (
        'the retry block compares item.status itself instead of delegating to the helper that '
        'excludes completed and ignored'
    )
