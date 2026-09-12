"""Public entrypoint: every 1C matrix is gated by self-tests, A/B0/B1 and preflight."""
from qualified_runner import main

if __name__ == "__main__":
    raise SystemExit(main())
