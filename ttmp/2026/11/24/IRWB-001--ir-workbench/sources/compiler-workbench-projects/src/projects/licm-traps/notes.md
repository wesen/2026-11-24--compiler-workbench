isPure is false for div and rem, so licm leaves them alone. Try the agent: ask it to write a licm that ignores this and watch the check fail on n = 0, b = 0.
