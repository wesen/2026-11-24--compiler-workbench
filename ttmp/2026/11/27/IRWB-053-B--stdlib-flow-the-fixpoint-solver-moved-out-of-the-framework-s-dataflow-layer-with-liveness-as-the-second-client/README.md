# stdlib/flow: the fixpoint solver, moved out of the framework's dataflow layer, with liveness as the second client

This is the document workspace for ticket IRWB-053-B.

## Structure

- **design/**: Design documents and architecture notes
- **reference/**: Reference documentation and API contracts
- **playbooks/**: Operational playbooks and procedures
- **scripts/**: Utility scripts and automation
- **sources/**: External sources and imported documents
- **various/**: Scratch or meeting notes, working notes
- **archive/**: Optional space for deprecated or reference-only artifacts

## Getting Started

Use docmgr commands to manage this workspace:

- Add documents: `docmgr doc add --ticket IRWB-053-B --doc-type design-doc --title "My Design"`
- Import sources: `docmgr import file --ticket IRWB-053-B --file /path/to/doc.md`
- Update metadata: `docmgr meta update --ticket IRWB-053-B --field Status --value review`
