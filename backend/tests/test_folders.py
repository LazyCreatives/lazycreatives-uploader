"""Folders: one list shared with Backups. A folder made in Backups shows here."""
from fastapi.testclient import TestClient

from lazyupload.api.app import create_app
from lazyupload.folders import Folders


def test_folders_made_in_backups_show_here(tmp_path):
    Folders().create("Club bangers", ["p1", "p2"])  # what Backups writes, in the shared place
    app = create_app(token="secret", db_path=tmp_path / "catalog.db")
    c = TestClient(app)
    c.headers["X-Auth-Token"] = "secret"
    got = c.get("/api/folders").json()
    assert [(f["name"], f["project_ids"]) for f in got["folders"]] == [("Club bangers", ["p1", "p2"])]
    fid = got["folders"][0]["id"]
    assert c.post(f"/api/folders/{fid}/remove", json={"project_ids": ["p1"]}).json()["project_ids"] == ["p2"]
    assert Folders().get(fid)["project_ids"] == ["p2"]
