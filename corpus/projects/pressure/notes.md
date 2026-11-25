With 14 or more registers nothing spills (112 bytes after O1); at 4, ten
values spill (252 bytes); at 1, eighteen (340 bytes). Every use of a
spilled value loads into t5 or t6 and every definition stores back.
