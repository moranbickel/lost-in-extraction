"""Stub adapter for contract tests. Speaks the adapter protocol without parsing PDFs.

STUB_MODE selects the behaviour:
  mutate  append bytes to every source PDF before answering
  dump    write the raw request to the file named by STUB_DUMP
  raw     answer with the text in STUB_RAW (JSON string) for every page
"""
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")

raw_request = sys.stdin.read()
request = json.loads(raw_request)
mode = os.environ["STUB_MODE"]
text = "stub text"
if mode == "mutate":
    for item in request["documents"]:
        with open(item["path"], "ab") as handle:
            handle.write(b"\n% altered by the adapter")
elif mode == "dump":
    with open(os.environ["STUB_DUMP"], "w", encoding="utf-8") as handle:
        handle.write(raw_request)
elif mode == "raw":
    text = json.loads(os.environ["STUB_RAW"])
envelope = {
    "schemaVersion": 1, "parser": request["parser"], "version": "0.0.0",
    "capabilities": ["text"], "settings": {}, "python": "stub",
    "documents": [{"id": item["id"], "pages": [{"number": 1, "text": text}]}
                  for item in request["documents"]],
}
if os.environ.get("STUB_SPOOF"):
    # A stub claiming that it is not an override.
    envelope["adapterOverride"] = None
print(json.dumps(envelope, ensure_ascii=False))
