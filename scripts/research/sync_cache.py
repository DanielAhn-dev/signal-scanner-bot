# -*- coding: utf-8 -*-
"""
연구용 데이터 캐시(.research-cache/, DART 분기재무+네이버 수정주가 등)를 GitHub Release
자산으로 올리고/받는다. 로컬 머신이 바뀌어도(새 PC, 새 세션 작업공간) 이 저장소에
접근 권한만 있으면 다시 받을 수 있다 — DART는 순차 호출만 되고 일일 호출 한도가 있어서,
매번 처음부터 새로 받으면 몇 시간씩 걸린다.

signal-scanner-bot(public)가 아니라 별도 private 저장소(starrichuniverse/signal-scanner-research-cache,
앱 코드 없이 캐시 전용으로 새로 만듦)의 GitHub Release 자산을 쓴다 — 연구 데이터가 공개되지 않고,
Supabase 무료 플랜 용량과도 무관하다(운영 DB에 연구용 대용량 데이터를 얹지 않음). GitHub 개인
계정은 private 저장소가 무료다(2019년부터 개수 제한 없음).

사용:
  python scripts/research/sync_cache.py pull   # 최신 캐시를 받아 .research-cache/ 에 풀기
  python scripts/research/sync_cache.py push   # 지금 .research-cache/ 를 release로 올리기 (갱신)

필요: gh CLI 로그인 상태(gh auth status) + CACHE_REPO에 대한 접근 권한.
.research-cache/ 는 revalidate_rules.py --cache 기본값과 동일.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import tarfile
import tempfile

CACHE_REPO = "starrichuniverse/signal-scanner-research-cache"
RELEASE_TAG = "research-cache"
ASSET_NAME = "research-cache.tar.gz"
CACHE_DIR = ".research-cache"


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    print("  $", " ".join(cmd), flush=True)
    return subprocess.run(cmd, **kwargs)


def release_exists() -> bool:
    # Windows 콘솔 기본 코드페이지(cp949)로 release notes의 한글을 못 읽어 스레드에서 터지는 걸 피한다
    res = run(
        ["gh", "release", "view", RELEASE_TAG, "--repo", CACHE_REPO],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    return res.returncode == 0


def cmd_push() -> None:
    if not os.path.isdir(CACHE_DIR):
        raise SystemExit(f"{CACHE_DIR} 가 없다 — 올릴 캐시가 없음 (먼저 revalidate_rules.py 실행)")

    with tempfile.TemporaryDirectory() as tmp:
        archive = os.path.join(tmp, ASSET_NAME)
        print(f"압축 중: {CACHE_DIR} -> {archive}")
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(CACHE_DIR, arcname=CACHE_DIR)
        size_mb = os.path.getsize(archive) / (1024 * 1024)
        print(f"압축 완료: {size_mb:.1f} MB")

        print(f"private repo '{CACHE_REPO}'의 release '{RELEASE_TAG}'에 올립니다.")
        if release_exists():
            run(["gh", "release", "upload", RELEASE_TAG, archive, "--repo", CACHE_REPO, "--clobber"], check=True)
        else:
            run(
                [
                    "gh", "release", "create", RELEASE_TAG, archive,
                    "--repo", CACHE_REPO,
                    "--title", "연구용 데이터 캐시 (DART+네이버)",
                    "--notes",
                    "scripts/research/*.py 용 캐시. sync_cache.py pull/push 로만 관리. "
                    "매번 최신 압축본으로 덮어씀(--clobber).",
                ],
                check=True,
            )
    print("완료: release", RELEASE_TAG, "에", ASSET_NAME, "업로드함")


def cmd_pull() -> None:
    if not release_exists():
        print(f"release '{RELEASE_TAG}' 가 아직 없음 — 캐시를 받을 수 없다. 먼저 push 해야 함.")
        return

    with tempfile.TemporaryDirectory() as tmp:
        run(
            ["gh", "release", "download", RELEASE_TAG, "--repo", CACHE_REPO, "-p", ASSET_NAME, "-D", tmp, "--clobber"],
            check=True,
        )
        archive = os.path.join(tmp, ASSET_NAME)
        print(f"압축 해제 중: {archive} -> .")
        with tarfile.open(archive, "r:gz") as tar:
            tar.extractall(".")
    print("완료:", CACHE_DIR, "에 캐시를 받았음")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("action", choices=["push", "pull"])
    args = ap.parse_args()

    if args.action == "push":
        cmd_push()
    else:
        cmd_pull()


if __name__ == "__main__":
    main()
