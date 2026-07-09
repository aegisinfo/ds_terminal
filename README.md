# Terminal DS

A cross-platform, split-pane GUI terminal emulator built on [xterm.js](https://xtermjs.org/) and Electron. One pane is meant for running [`aegis-cli`](https://github.com/aegisinfo/aegiscode), the other for a plain shell — side by side in the same window.

## Features

- **Split panes** — vertical or horizontal, each pane is an independent PTY session
- **Cross-platform** — Linux, macOS, Windows, using the native default shell on each (`bash`/`zsh`/`powershell.exe`)
- **xterm.js rendering** — fast, GPU-friendly terminal rendering with fit, web-links, and search addons
- **Multiple windows** — open additional independent terminal windows

## Installation

### Linux (apt)

Download the latest `.deb` from the [Releases page](https://github.com/aegisinfo/ds_terminal/releases), then install it with `apt` (this resolves and installs any missing dependencies automatically):

```bash
curl -LO https://github.com/aegisinfo/ds_terminal/releases/latest/download/terminal-ds_1.0.1_amd64.deb
sudo apt install ./terminal-ds_1.0.1_amd64.deb
```

Launch it from your applications menu, or from a terminal:

```bash
terminal-ds
```

### From source

Requires [Node.js](https://nodejs.org/) 18+.

```bash
git clone https://github.com/aegisinfo/ds_terminal.git
cd ds_terminal
npm install
npm start
```

## Building the .deb yourself

```bash
npm install
npm run build:linux
```

The packaged `.deb` is written to `dist/`.

## Keyboard shortcuts

| Shortcut                  | Action              |
|----------------------------|----------------------|
| `Ctrl/Cmd+Shift+5`         | Split pane vertically |
| `Ctrl/Cmd+Shift+6`         | Split pane horizontally |
| `Ctrl/Cmd+Shift+N`         | New window |

## License

[MIT](LICENSE)
