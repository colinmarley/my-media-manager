"""
Regression test for issue #4: the Firestore-era /api/media/* routes are gone,
while the live /api/media/extras/* routes remain registered.
"""

import importlib.util

import pytest

DEAD_ROUTES = {
    ("POST", "/api/media/files/scan"),
    ("GET", "/api/media/files/{fileId}"),
    ("POST", "/api/media/assign/movie"),
    ("POST", "/api/media/assign/episode"),
    ("POST", "/api/media/organize/{assignmentId}"),
    ("GET", "/api/media/jellyfin/validate/{folderId}"),
}


@pytest.fixture()
def registered_routes():
    from main import app

    routes = set()
    for route in app.routes:
        for method in getattr(route, "methods", None) or ():
            routes.add((method, route.path))
    return routes


def test_dead_firestore_media_routes_not_registered(registered_routes):
    assert DEAD_ROUTES.isdisjoint(registered_routes)


def test_extras_routes_still_registered(registered_routes):
    assert ("GET", "/api/media/extras/categories") in registered_routes
    assert ("GET", "/api/media/extras/pending") in registered_routes


@pytest.mark.parametrize(
    "module", ["api.media_operations", "services.media_resolution_service"]
)
def test_dead_modules_deleted(module):
    assert importlib.util.find_spec(module) is None
