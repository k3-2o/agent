#!/usr/bin/env python3
"""
Quick validation script for agent skills.

Validates SKILL.md frontmatter and structure per the Agent Skills
standard (https://agentskills.io/specification), with the
disable-model-invocation field used by several harnesses.

Usage:
    quick_validate.py <skill_directory>
"""

import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("[ERROR] PyYAML is required. Install with: pip install pyyaml")
    sys.exit(1)


MAX_SKILL_NAME_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 1024
MAX_COMPATIBILITY_LENGTH = 500

ALLOWED_FRONTMATTER_KEYS = {
    "name",
    "description",
    "license",
    "compatibility",
    "metadata",
    "allowed-tools",
    "disable-model-invocation",
}


def validate_skill(skill_path):
    """Basic validation of an agent skill."""
    skill_path = Path(skill_path)

    if not skill_path.exists():
        return False, f"Skill directory not found: {skill_path}"
    if not skill_path.is_dir():
        return False, f"Path is not a directory: {skill_path}"

    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        return False, "SKILL.md not found in skill directory"

    content = skill_md.read_text(encoding="utf-8")

    # Check for YAML frontmatter
    if not content.startswith("---"):
        return False, "No YAML frontmatter found. SKILL.md must start with '---'."

    match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return False, "Invalid frontmatter format. Expected: ---\\n...\\n---"

    frontmatter_text = match.group(1)

    # Parse YAML
    try:
        frontmatter = yaml.safe_load(frontmatter_text)
        if not isinstance(frontmatter, dict):
            return False, "Frontmatter must be a YAML dictionary"
    except yaml.YAMLError as e:
        return False, f"Invalid YAML in frontmatter: {e}"

    # Check for unexpected keys
    unexpected_keys = set(frontmatter.keys()) - ALLOWED_FRONTMATTER_KEYS
    if unexpected_keys:
        allowed = ", ".join(sorted(ALLOWED_FRONTMATTER_KEYS))
        unexpected = ", ".join(sorted(unexpected_keys))
        return (
            False,
            f"Unexpected key(s) in frontmatter: {unexpected}. "
            f"Allowed: {allowed}",
        )

    # Check required fields
    if "name" not in frontmatter:
        return False, "Missing required field 'name' in frontmatter"

    if "description" not in frontmatter:
        return False, "Missing required field 'description' in frontmatter"

    # Validate name
    name = frontmatter.get("name", "")
    if not isinstance(name, str):
        return False, f"'name' must be a string, got {type(name).__name__}"
    name = name.strip()
    if not name:
        return False, "'name' is empty or whitespace only"
    if not re.match(r"^[a-z0-9-]+$", name):
        return (
            False,
            f"'name' '{name}' must be lowercase hyphen-case (letters, digits, hyphens only)",
        )
    if name.startswith("-") or name.endswith("-"):
        return False, f"'name' '{name}' cannot start or end with a hyphen"
    if "--" in name:
        return False, f"'name' '{name}' cannot contain consecutive hyphens"
    if len(name) > MAX_SKILL_NAME_LENGTH:
        return (
            False,
            f"'name' is too long ({len(name)} chars). "
            f"Maximum is {MAX_SKILL_NAME_LENGTH} characters.",
        )

    # Validate description
    description = frontmatter.get("description", "")
    if not isinstance(description, str):
        return False, f"'description' must be a string, got {type(description).__name__}"
    description = description.strip()
    if not description:
        return False, "'description' is empty or whitespace only"
    if len(description) > MAX_DESCRIPTION_LENGTH:
        return (
            False,
            f"'description' is too long ({len(description)} chars). "
            f"Maximum is {MAX_DESCRIPTION_LENGTH} characters.",
        )

    # Validate compatibility (if present)
    if "compatibility" in frontmatter:
        compat = frontmatter["compatibility"]
        if not isinstance(compat, str):
            return False, f"'compatibility' must be a string, got {type(compat).__name__}"
        if len(compat) > MAX_COMPATIBILITY_LENGTH:
            return (
                False,
                f"'compatibility' is too long ({len(compat)} chars). "
                f"Maximum is {MAX_COMPATIBILITY_LENGTH} characters.",
            )

    # Validate disable-model-invocation (if present)
    if "disable-model-invocation" in frontmatter:
        dmi = frontmatter["disable-model-invocation"]
        if not isinstance(dmi, bool):
            return (
                False,
                f"'disable-model-invocation' must be a boolean (true/false), "
                f"got {type(dmi).__name__}",
            )

    # Validate allowed-tools (if present)
    if "allowed-tools" in frontmatter:
        at = frontmatter["allowed-tools"]
        if not isinstance(at, str):
            return (
                False,
                f"'allowed-tools' must be a string (space-delimited), "
                f"got {type(at).__name__}",
            )

    # Check that body exists (content after frontmatter)
    body = content[match.end():].strip()
    if not body:
        return False, "SKILL.md has frontmatter but no body content"

    return True, "Skill is valid!"


def main():
    if len(sys.argv) != 2:
        print("Usage: python quick_validate.py <skill_directory>")
        sys.exit(1)

    valid, message = validate_skill(sys.argv[1])
    print(message)
    sys.exit(0 if valid else 1)


if __name__ == "__main__":
    main()
