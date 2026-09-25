"""Checks the websocket contract with a stub model (no weights needed). Run: .venv/bin/python test_main.py"""
import io
import sys
import types

import numpy as np
from PIL import Image


class FakeModel:
    def predict(self, img, threshold):
        return types.SimpleNamespace(data={"class_name": np.array(["person", "person", "cell phone", "cup"], dtype=object)})


sys.modules["rfdetr"] = types.SimpleNamespace(RFDETRNano=FakeModel, RFDETRSmall=FakeModel, RFDETRMedium=FakeModel)
import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

client = TestClient(main.app)
buf = io.BytesIO()
Image.new("RGB", (64, 48)).save(buf, "JPEG")

with client.websocket_connect("/ws", headers={"origin": "http://localhost:3000"}) as ws:
    ws.send_bytes(buf.getvalue())
    r = ws.receive_json()
    assert (r["persons"], r["phones"]) == (2, 1), r
    ws.send_bytes(b"not a jpeg")
    assert "error" in ws.receive_json()
    ws.send_bytes(buf.getvalue())  # stream survives a bad frame
    assert ws.receive_json()["persons"] == 2

try:
    with client.websocket_connect("/ws", headers={"origin": "http://evil.example"}) as ws:
        ws.receive_json()
    raise AssertionError("foreign origin was accepted")
except WebSocketDisconnect as e:
    assert e.code == 1008

assert client.get("/health").json()["ok"]
print("vision ws contract ok")
