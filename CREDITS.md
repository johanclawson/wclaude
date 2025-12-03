# Credits & Attribution

This project builds upon the work of several contributors. Full credit and appreciation goes to:

## Core Contributors

### somersby10ml - [win-claude-code](https://github.com/somersby10ml/win-claude-code)

**License:** MIT

**Contribution:** Original Node.js hooks that make Claude Code work on Windows:
- `fs.accessSync` hook to fake `/bin/bash` existence
- `os.tmpdir` hook for path conversion
- `child_process.spawn` hook to redirect bash calls to Git Bash

This project's `runner.js` is derived from somersby10ml's original work.

### aaronvstory - [claude-code-windows-setup](https://github.com/aaronvstory/claude-code-windows-setup)

**License:** MIT

**Contribution:** Comprehensive Windows launcher setup including:
- PowerShell launcher scripts with environment configuration
- BAT wrappers for easy execution
- Registry files for context menu integration
- Documentation on Windows-specific fixes

The launcher scripts in this project are inspired by aaronvstory's work.

### Anthropic Claude Code Community

**Reference:** [GitHub Issue #9745](https://github.com/anthropics/claude-code/issues/9745)

**Contribution:** Documentation of the EPERM crash issue on Windows and the community-driven approach to fixing it using `taskkill` as a fallback.

## Additional Resources

- [GitHub Issue #5615](https://github.com/anthropics/claude-code/issues/5615) - Timeout configuration documentation
- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code) - Official Anthropic documentation

## License

This project is licensed under the MIT License, consistent with the original projects it builds upon.

---

If you've contributed to making Claude Code work better on Windows and should be listed here, please open an issue or pull request.
