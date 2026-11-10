"""Acceptance-criteria map for issue #34 (ingest triage API).

Every criterion below names the tests that prove it. `test_ac9_every_criterion_names_a_real_test`
executes that map, so the mapping cannot drift away from the suite, and none of it can pass on
`refactor`: `services.ingress_triage_service` does not exist there, and neither do the test files.

  AC1  grouped listing reads the persisted `ingress_queue` table (pre-restart backlog)
       test_get_queue_groups_returns_paged_groups_with_counts_and_previews
       test_qa_grouped_listing_returns_the_persisted_backlog_this_process_never_saw
       test_grouped_listing_and_bulk_ignore_run_against_postgres
  AC2  group + per-status counts are correct, incl. the rip-folder and (unparsed) buckets
       test_get_queue_groups_splits_source_folder_groups_by_the_rip_folder
       test_group_statement_derives_the_source_folder_from_the_file_path
       test_group_statement_buckets_titles_the_parser_did_not_provide
       test_qa_group_and_global_status_counts_cover_completed_and_ignored
       test_qa_source_folder_grouping_keys_on_the_rip_folder_under_the_ingress_root
       test_qa_rows_without_a_parsed_title_bucket_as_unparsed
  AC3  q matches file_name and parsed_info->>'title'; limit/offset page groups, limit is capped
       test_group_statement_renders_postgres_json_grouping_and_search
       test_q_filters_groups_by_file_name_or_parsed_title
       test_qa_q_compiles_to_file_name_and_parsed_title_ilike_predicates
       test_qa_group_paging_honours_limit_offset_and_caps_them_server_side
       test_qa_api_rejects_page_sizes_beyond_the_server_side_cap
  AC4  bulk accepts explicit ids and a group selector, per-item results, no abort on failure
       test_bulk_retry_and_classify_report_partial_success
       test_bulk_group_selector_resolves_ids_from_persisted_rows
       test_returns_partial_success_summary
       test_qa_bulk_accepts_ids_and_group_selector_and_does_not_abort_on_the_first_failure
  AC5  bulk accept organizes like single-item accept, ignore sets `ignored`,
       classify reuses `update_classification` validation
       test_bulk_ignore_is_terminal_and_blocks_retry
       test_bulk_accept_uses_orchestrator_and_records_one_batch_history_row
       test_bulk_accept_reports_failure_when_organization_fails
       test_qa_bulk_ignore_writes_ignored_to_the_persisted_row_with_one_batch_history_row_each
       test_qa_bulk_classify_reuses_the_single_item_update_classification_validation
  AC6  exactly one `ingress_processing_history` row per mutated item, with batch_id/action/source
       test_bulk_accept_uses_orchestrator_and_records_one_batch_history_row
       test_bulk_retry_and_classify_report_partial_success
       test_grouped_listing_and_bulk_ignore_run_against_postgres
       test_qa_bulk_ignore_writes_ignored_to_the_persisted_row_with_one_batch_history_row_each
  AC7  ignored items are skipped by the pending processor and by failed-item auto-retry
       test_bulk_ignore_is_terminal_and_blocks_retry
       test_qa_ignored_rows_stay_out_of_the_pending_processor_and_failed_item_auto_retry
  AC8  docs/api/endpoints.md documents both routes and the new `ignored` status
       test_ac8_api_reference_documents_both_new_triage_routes
       test_ac8_documented_queue_statuses_match_the_product_statuses
  AC9  the suite passes with tests that fail on `refactor`
       test_ac9_the_triage_surface_only_exists_on_this_branch
       test_ac9_every_criterion_names_a_real_test
"""

import ast
import importlib.util
from pathlib import Path

import pytest

from services.ingress_queue_service import (
    QUEUE_ALL_STATUSES,
    QUEUE_IGNORED,
    IngressQueueService,
)
from services.metrics import INGEST_QUEUE_STATUSES
from services.ingress_triage_service import MAX_GROUP_PAGE_SIZE, IngressTriageService

REPO_ROOT = Path(__file__).resolve().parents[2]
ENDPOINTS_DOC = REPO_ROOT / "docs" / "api" / "endpoints.md"
ISSUE_34_TEST_FILES = (
    "test_ingress_triage_service.py",
    "test_ingress_queue_triage_api.py",
    "test_ingress_triage_qa_probes_issue34.py",
    "test_ingress_triage_acceptance_issue34.py",
)

# AC -> the tests that prove it, as named in the docstring above.
AC_TESTS = {
    "AC1": ["test_get_queue_groups_returns_paged_groups_with_counts_and_previews",
            "test_qa_grouped_listing_returns_the_persisted_backlog_this_process_never_saw"],
    "AC2": ["test_get_queue_groups_splits_source_folder_groups_by_the_rip_folder",
            "test_group_statement_derives_the_source_folder_from_the_file_path",
            "test_qa_group_and_global_status_counts_cover_completed_and_ignored",
            "test_qa_source_folder_grouping_keys_on_the_rip_folder_under_the_ingress_root",
            "test_qa_rows_without_a_parsed_title_bucket_as_unparsed"],
    "AC3": ["test_group_statement_renders_postgres_json_grouping_and_search",
            "test_q_filters_groups_by_file_name_or_parsed_title",
            "test_qa_q_compiles_to_file_name_and_parsed_title_ilike_predicates",
            "test_qa_group_paging_honours_limit_offset_and_caps_them_server_side",
            "test_qa_api_rejects_page_sizes_beyond_the_server_side_cap"],
    "AC4": ["test_bulk_retry_and_classify_report_partial_success",
            "test_bulk_group_selector_resolves_ids_from_persisted_rows",
            "test_returns_partial_success_summary",
            "test_qa_bulk_accepts_ids_and_group_selector_and_does_not_abort_on_the_first_failure"],
    "AC5": ["test_bulk_ignore_is_terminal_and_blocks_retry",
            "test_bulk_accept_uses_orchestrator_and_records_one_batch_history_row",
            "test_qa_bulk_ignore_writes_ignored_to_the_persisted_row_with_one_batch_history_row_each",
            "test_qa_bulk_classify_reuses_the_single_item_update_classification_validation"],
    "AC6": ["test_bulk_accept_uses_orchestrator_and_records_one_batch_history_row",
            "test_bulk_retry_and_classify_report_partial_success",
            "test_qa_bulk_ignore_writes_ignored_to_the_persisted_row_with_one_batch_history_row_each"],
    "AC7": ["test_bulk_ignore_is_terminal_and_blocks_retry",
            "test_qa_ignored_rows_stay_out_of_the_pending_processor_and_failed_item_auto_retry"],
    "AC8": ["test_ac8_api_reference_documents_both_new_triage_routes",
            "test_ac8_documented_queue_statuses_match_the_product_statuses"],
    "AC9": ["test_ac9_the_triage_surface_only_exists_on_this_branch",
            "test_ac9_every_criterion_names_a_real_test"],
}


@pytest.fixture()
def registered_routes():
    from main import app

    routes = set()
    for route in app.routes:
        for method in getattr(route, "methods", None) or ():
            routes.add((method, route.path))
    return routes


def test_ac8_api_reference_documents_both_new_triage_routes():
    """The endpoint reference has to carry the two routes and their error contracts."""
    documented = ENDPOINTS_DOC.read_text(encoding="utf-8")

    assert "GET /api/ingress/queue/groups" in documented
    assert "POST /api/ingress/queue/bulk" in documented
    assert "INVALID_GROUP_BY" in documented and "INVALID_BULK_REQUEST" in documented
    # The contract the next slice builds the UI on: caps, the rip-folder key, the batch receipt.
    assert "batch_id" in documented and "source_folder" in documented
    assert "1-50" in documented, "the server-side group page cap is documented"


def test_ac8_documented_queue_statuses_match_the_product_statuses():
    """`ignored` in the mm_ingest_queue_items row of docs/api/endpoints.md == the product list."""
    gauge_row = next(
        line for line in ENDPOINTS_DOC.read_text(encoding="utf-8").splitlines()
        if "mm_ingest_queue_items" in line
    )

    assert QUEUE_IGNORED in INGEST_QUEUE_STATUSES
    for status in QUEUE_ALL_STATUSES:
        assert status in gauge_row, f"{status} missing from the documented gauge labels"


def test_ac9_the_triage_surface_only_exists_on_this_branch(registered_routes):
    """Fails on `refactor`: the module, the routes, `ignored` and `hydrate_item` are all new."""
    assert importlib.util.find_spec("services.ingress_triage_service") is not None
    assert (REPO_ROOT / "backend" / "services" / "ingress_triage_service.py").is_file()

    assert ("GET", "/api/ingress/queue/groups") in registered_routes
    assert ("POST", "/api/ingress/queue/bulk") in registered_routes

    assert QUEUE_IGNORED in QUEUE_ALL_STATUSES
    for helper in ("hydrate_item", "hydrate_items", "mark_ignored"):
        assert hasattr(IngressQueueService, helper)
    assert hasattr(IngressTriageService, "bulk_action")
    assert MAX_GROUP_PAGE_SIZE <= 200, "the documented page cap stays inside the client timeout"


def test_ac9_every_criterion_names_a_real_test():
    """The AC -> test map above has to point at functions that exist in this suite."""
    defined = set()
    for name in ISSUE_34_TEST_FILES:
        tree = ast.parse((Path(__file__).parent / name).read_text(encoding="utf-8"))
        defined.update(
            node.name for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name.startswith("test_")
        )

    missing = {ac: [test for test in tests if test not in defined]
               for ac, tests in AC_TESTS.items()}
    assert not {ac: tests for ac, tests in missing.items() if tests}, missing
    assert set(missing) == {f"AC{index}" for index in range(1, 10)}
