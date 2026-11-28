---
Title: One checked application, two ways to obtain a fact
Ticket: IRWB-051-B
Status: review
Topics: [framework]
DocType: design-doc
---

# One checked application, two ways to obtain a fact

For same-IR native kernels, including Typed Tx kernels that return void on identity, a generator owns eligibility, input checks, fact requests, private preparation, declared writes, output checks, preservation and publication. Each suspension supplies a synchronous and asynchronous way to obtain the same analysis record. Both drivers resume at the same instruction and deliver errors into the generator. Straight-line checks and publication need no suspension. Two thin runners would be simpler individually but would have to agree on every exit from this sequence.

The transformation names the relation that the output check tests. Requires checks the input. Ensures checks a changed candidate. Preserves names analyses whose values survive. Use existing domain differential checks and the framework's correspondence and publication routines. Exercise preservation by recomputation with audit enabled. Constprop declares both a reaching-definition need and three nonempty preservation claims. LICM and BCE both have empty preservation lists in this checkout.

Share the manager's lookup, epoch, validation, record insertion and events. The synchronous miss supports pure leaf analyses returning a value immediately. The asynchronous path keeps context dependencies and drains pending work. Calling the definition directly from the driver would lose invalidation and provenance. Test hits in both directions as well as invalidation.

Compare both drivers against existing runners on corpus inputs. Benchmark a fixed attention artifact with the oracle's trivial gate, then a Typed application with matching analysis and preservation work. Separate semantic equality from the timing control. Recommend the shared lifecycle if the manager needs only execution-mode plumbing and measurements show its dispatch cost is small relative to application cost.

## Later

- Strategy interpretation and migration of production callers belong to the selected implementation.
- General asynchronous manager contracts use the existing deferred verification API. This spike exercises synchronous domain checks and accepted publication.
- Cross-IR ports, transfer optimization and proof algebra are unnecessary for these two kernels.
