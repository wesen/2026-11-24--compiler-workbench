The loop test y !== 0 dominates the rem, but the backend only reads
intervals, and ranges does not refine on !==. A gap worth closing.
