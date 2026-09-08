#!/usr/bin/env python3
"""Check, or reproduce from npm, the byte-identical pinned browser SDK."""

import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import tarfile
from urllib.request import urlopen


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--download", action="store_true",
        help="Download the pinned npm tarball, verify it, then replace supabase.js",
    )
    args = parser.parse_args()
    directory = Path(__file__).resolve().parent
    lock = json.loads((directory / "supabase.lock.json").read_text())
    target = directory / lock["output"]

    if args.download:
        with urlopen(lock["registryMetadataUrl"], timeout=45) as response:
            metadata = json.load(response)
        require(metadata["name"] == lock["package"], "Unexpected npm package")
        require(metadata["version"] == lock["version"], "Unexpected npm version")
        require(metadata["dist"]["integrity"] == lock["distIntegrity"], "npm integrity changed")
        require(metadata["dist"]["tarball"] == lock["tarballUrl"], "npm tarball URL changed")
        with urlopen(lock["tarballUrl"], timeout=45) as response:
            tarball = response.read()
        integrity = "sha512-" + base64.b64encode(hashlib.sha512(tarball).digest()).decode()
        require(integrity == lock["distIntegrity"], "npm tarball SHA-512 mismatch")
        require(hashlib.sha256(tarball).hexdigest() == lock["tarballSha256"], "npm tarball SHA-256 mismatch")
        with tarfile.open(fileobj=io.BytesIO(tarball), mode="r:gz") as package:
            with package.extractfile(lock["upstreamPath"]) as member:
                bundle = member.read()
        require(hashlib.sha256(bundle).hexdigest() == lock["bundleSha256"], "Extracted bundle SHA-256 mismatch")
        require(len(bundle) == lock["bundleBytes"], "Extracted bundle size mismatch")
        target.write_bytes(bundle)

    bundle = target.read_bytes()
    require(hashlib.sha256(bundle).hexdigest() == lock["bundleSha256"], "Vendored bundle SHA-256 mismatch")
    require(len(bundle) == lock["bundleBytes"], "Vendored bundle size mismatch")
    print(f"Verified {lock['package']}@{lock['version']}: {lock['bundleSha256']}")


if __name__ == "__main__":
    main()
