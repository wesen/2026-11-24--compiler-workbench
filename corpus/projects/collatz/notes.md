The && in the loop test is lowered into a temporary, so the body is
guarded by a test of that temporary, not of x > 1. ranges loses the
fact, and strength leaves x % 2 and x / 2 as they are.
