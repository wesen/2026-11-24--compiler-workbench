# Review of doc-E

## Must change

1. **Wrong `split-sum` variant.** "Mutate the block result to drop the final partial block in the test candidate. In the fixed-shape fixture, make a valid eight-column prefix with `prefix[i,d]: f32[1,8] = x[i,d+i];` and block the sum over that prefix." What the prefix fixture shows, and its expected verdict, are never stated. Define the wrong variant as a pass kernel run through the sync gate on the contract's cases.
2. **Budget.** "Fail the check if a candidate exhausts that budget on a selected case". The budget is measured "per origin case", and `split-sum` adds outer accumulation visits. A correct candidate near the cap is therefore rejected. Say how the candidate's budget is set.
3. **`NUMBER` is undefined.** "Numeric expressions accept finite JS numeric literals" admits `0x10`, `1_0` and `.5`. Give the token grammar.
4. **Case selection.** "plus seeded mixed assignments from those sizes and targeted shapes with a full block and a tail" fixes neither how many assignments there are nor how they are chosen.

## Cut

1. Inline's second check, "Check the result against the original as well … tolerance for functions where an earlier split was accepted", and "Store the set of functions that entered tolerance mode". Exact agreement with the input on the same origin-derived cases implies both.
2. "Bind shape names … by solving the affine signature equations … rational elimination" and "Record constraints that depend on concrete sizes and check them when the call binds". These add a solver and a call-time error contract.

## Framework changes

- **`applyNativePassSync` with shared native-candidate preparation:** needed, because the fixed API is synchronous, and correctly placed. As specified it is not minimal: "receives a pass ID, version, IR definition, adapter, write declarations, kernel and mandatory check" duplicates `definePass`. Take a `Pass` and refuse `needs` and `preserves`.
- No missed change.

## Keep

Keep the rule that tolerance cases are chosen "with entirely finite reference outputs independently of the candidate". Keep the 0.25-tail witness (`0x3fa00000` against `0x3fa00002`, verified), which catches both the reassociation and a dropped tail.
