j - 1 is not the loop variable, so bce keeps those checks: it needs j -
1 >= 0, which the && test does prove. A smarter bce could use it.
