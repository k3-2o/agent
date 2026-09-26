#!/usr/bin/env python3
"""
Skill Initializer — Creates a new agent skill from template.

Usage:
    init_skill.py <skill-name> --path <path> [--resources scripts,references] [--examples]

Examples:
    init_skill.py my-new-skill --path /path/to/skills
    init_skill.py my-new-skill --path /path/to/skills --resources scripts,references
    init_skill.py project-tools --path /path/to/skills --resources scripts --examples
    init_skill.py my-skill --path /custom/location
"""

import argparse
import re
import sys
from pathlib import Path

MAX_SKILL_NAME_LENGTH = 64
ALLOWED_RESOURCES = {"scripts", "references"}

SKILL_TEMPLATE = """---
name: {skill_name}
description: "[TODO: Complete and informative explanation of what the skill does and when to use it. Include WHEN to use this skill — specific scenarios, file types, or tasks that trigger it. Max 1024 chars.]"
compatibility: "[TODO: Environment requirements, if any. Max 500 chars. Delete if not needed.]"
---

# {skill_title}

## Overview

[TODO: 1-2 sentences explaining what this skill enables.]

## Usage

[TODO: Instructions for the agent to follow when this skill activates. Consider:

**Workflow-Based** (best for sequential processes):
- Clear step-by-step procedures
- Decision trees for complex workflows

**Task-Based** (best for tool collections):
- Different operations listed independently
- Quick-start examples

**Reference/Guidelines** (best for standards):
- Conventions, schemas, business logic
- When each rule applies

Delete this guidance block and replace with actual skill content.]

## [TODO: First main section]

[TODO: Add actual instructions here. Use relative paths for everything:
```bash
python scripts/my-script.py <input>
```
See [references/details.md](references/details.md) for more.]

## Resources

### scripts/
Executable code (Python/Bash/etc.) for deterministic or repeated operations.

### references/
Documentation loaded into context on demand to inform the agent's process.
"""

EXAMPLE_SCRIPT = """#!/usr/bin/env python3
\"\"\"
Example helper script for {skill_name}

Replace with actual implementation or delete if not needed.
\"\"\"

def main():
    print("This is an example script for {skill_name}")
    # TODO: Add actual script logic here

if __name__ == "__main__":
    main()
"""

EXAMPLE_REFERENCE = """# Reference: {skill_title}

Replace with actual reference content or delete if not needed.

## When Reference Docs Are Useful

- Comprehensive documentation too lengthy for SKILL.md
- Content only needed for specific use cases
- API references, schemas, detailed workflows

## Structure Suggestions

### API Reference
- Overview
- Endpoints with examples
- Error codes
- Rate limits

### Workflow Guide
- Prerequisites
- Step-by-step instructions
- Common patterns
- Troubleshooting
"""


def normalize_skill_name(skill_name):
    """Normalize a skill name to lowercase hyphen-case."""
    normalized = skill_name.strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    normalized = normalized.strip("-")
    normalized = re.sub(r"-{2,}", "-", normalized)
    return normalized


def title_case_skill_name(skill_name):
    """Convert hyphenated skill name to Title Case for display."""
    return " ".join(word.capitalize() for word in skill_name.split("-"))


def parse_resources(raw_resources):
    if not raw_resources:
        return []
    resources = [item.strip() for item in raw_resources.split(",") if item.strip()]
    invalid = sorted({item for item in resources if item not in ALLOWED_RESOURCES})
    if invalid:
        allowed = ", ".join(sorted(ALLOWED_RESOURCES))
        print(f"[ERROR] Unknown resource type(s): {', '.join(invalid)}")
        print(f"   Allowed: {allowed}")
        sys.exit(1)
    deduped = []
    seen = set()
    for resource in resources:
        if resource not in seen:
            deduped.append(resource)
            seen.add(resource)
    return deduped


def create_resource_dirs(skill_dir, skill_name, skill_title, resources, include_examples):
    for resource in resources:
        resource_dir = skill_dir / resource
        resource_dir.mkdir(exist_ok=True)
        if resource == "scripts":
            if include_examples:
                example_script = resource_dir / "example.py"
                example_script.write_text(EXAMPLE_SCRIPT.format(skill_name=skill_name))
                example_script.chmod(0o755)
                print("[OK] Created scripts/example.py")
            else:
                print("[OK] Created scripts/")
        elif resource == "references":
            if include_examples:
                example_reference = resource_dir / "api_reference.md"
                example_reference.write_text(EXAMPLE_REFERENCE.format(skill_title=skill_title))
                print("[OK] Created references/api_reference.md")
            else:
                print("[OK] Created references/")


def init_skill(skill_name, path, resources, include_examples):
    """
    Initialize a new skill directory with template SKILL.md.

    Args:
        skill_name: Name of the skill
        path: Path where the skill directory should be created
        resources: Resource directories to create
        include_examples: Whether to create example files

    Returns:
        Path to created skill directory, or None if error
    """
    skill_dir = Path(path).resolve() / skill_name

    if skill_dir.exists():
        print(f"[ERROR] Skill directory already exists: {skill_dir}")
        return None

    try:
        skill_dir.mkdir(parents=True, exist_ok=False)
        print(f"[OK] Created skill directory: {skill_dir}")
    except Exception as e:
        print(f"[ERROR] Error creating directory: {e}")
        return None

    # Create SKILL.md from template
    skill_title = title_case_skill_name(skill_name)
    skill_content = SKILL_TEMPLATE.format(skill_name=skill_name, skill_title=skill_title)

    skill_md_path = skill_dir / "SKILL.md"
    try:
        skill_md_path.write_text(skill_content)
        print("[OK] Created SKILL.md")
    except Exception as e:
        print(f"[ERROR] Error creating SKILL.md: {e}")
        return None

    # Create resource directories if requested
    if resources:
        try:
            create_resource_dirs(skill_dir, skill_name, skill_title, resources, include_examples)
        except Exception as e:
            print(f"[ERROR] Error creating resource directories: {e}")
            return None

    # Print next steps
    print(f"\n[OK] Skill '{skill_name}' initialized successfully at {skill_dir}")
    print("\nNext steps:")
    print("1. Edit SKILL.md to complete the TODO items and update the description")
    if resources:
        if include_examples:
            print("2. Customize or delete the example files in scripts/ and references/")
        else:
            print("2. Add resources to scripts/ and references/ as needed")
    else:
        print("2. Create resource directories only if needed (scripts/, references/)")
    print("3. Validate the skill when ready:")
    print(f"   python scripts/quick_validate.py {skill_dir}")

    return skill_dir


def main():
    parser = argparse.ArgumentParser(
        description="Create a new agent skill directory with a SKILL.md template.",
    )
    parser.add_argument("skill_name", help="Skill name (normalized to hyphen-case)")
    parser.add_argument("--path", required=True, help="Output directory for the skill")
    parser.add_argument(
        "--resources",
        default="",
        help="Comma-separated list: scripts,references",
    )
    parser.add_argument(
        "--examples",
        action="store_true",
        help="Create example files inside the selected resource directories",
    )
    args = parser.parse_args()

    raw_skill_name = args.skill_name
    skill_name = normalize_skill_name(raw_skill_name)
    if not skill_name:
        print("[ERROR] Skill name must include at least one letter or digit.")
        sys.exit(1)
    if len(skill_name) > MAX_SKILL_NAME_LENGTH:
        print(
            f"[ERROR] Skill name '{skill_name}' is too long ({len(skill_name)} characters). "
            f"Maximum is {MAX_SKILL_NAME_LENGTH} characters."
        )
        sys.exit(1)
    if skill_name != raw_skill_name:
        print(f"Note: Normalized skill name from '{raw_skill_name}' to '{skill_name}'.")

    resources = parse_resources(args.resources)
    if args.examples and not resources:
        print("[ERROR] --examples requires --resources to be set.")
        sys.exit(1)

    path = args.path

    print(f"Initializing skill: {skill_name}")
    print(f"   Location: {path}")
    if resources:
        print(f"   Resources: {', '.join(resources)}")
        if args.examples:
            print("   Examples: enabled")
    else:
        print("   Resources: none (create as needed)")
    print()

    result = init_skill(skill_name, path, resources, args.examples)

    if result:
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
