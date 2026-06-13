/**
 * Touch/Virtual Keyboard for ZX Spectrum Emulator
 * Provides on-screen keyboard for mobile devices
 */

export class TouchKeyboard {
  constructor(spectrum, container) {
    this.spectrum = spectrum;
    this.container = container;
    this.element = null;
    this.isVisible = false;
    this.activeKeys = new Set();

    this._init();
  }

  _init() {
    // Create keyboard container
    this.element = document.createElement('div');
    this.element.className = 'zx-touch-keyboard';
    this.element.innerHTML = this._generateKeyboardHTML();

    // Add default styles
    this._addStyles();

    // Attach to container
    if (typeof this.container === 'string') {
      document.querySelector(this.container).appendChild(this.element);
    } else {
      this.container.appendChild(this.element);
    }

    // Setup event handlers
    this._setupEventHandlers();

    // Auto-detect if we should show keyboard
    if (this._isTouchDevice()) {
      this.show();
    }
  }

  _generateKeyboardHTML() {
    const rows = [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
      ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'ENTER'],
      ['CAPS', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'SYMB', 'SPACE'],
    ];

    let html = '<div class="zx-keyboard-toggle">⌨️</div>';
    html += '<div class="zx-keyboard-layout">';

    rows.forEach((row, rowIndex) => {
      html += `<div class="zx-keyboard-row row-${rowIndex}">`;
      row.forEach((key) => {
        const displayKey = this._getDisplayKey(key);
        const className = this._getKeyClass(key);
        html += `<button class="zx-key ${className}" data-key="${key}">${displayKey}</button>`;
      });
      html += '</div>';
    });

    // Add arrow keys row
    html += '<div class="zx-keyboard-row row-arrows">';
    html += '<button class="zx-key key-arrow" data-key="ArrowLeft">←</button>';
    html += '<button class="zx-key key-arrow" data-key="ArrowDown">↓</button>';
    html += '<button class="zx-key key-arrow" data-key="ArrowUp">↑</button>';
    html += '<button class="zx-key key-arrow" data-key="ArrowRight">→</button>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  _getDisplayKey(key) {
    const displayMap = {
      CAPS: 'CAPS SHIFT',
      SYMB: 'SYMBOL',
      SPACE: '━━━━━',
      ENTER: '↵',
    };
    return displayMap[key] || key;
  }

  _getKeyClass(key) {
    const classes = [];
    if (['CAPS', 'SYMB', 'ENTER', 'SPACE'].includes(key)) {
      classes.push('key-special');
    }
    if (key === 'SPACE') {
      classes.push('key-space');
    }
    if (key === 'ENTER') {
      classes.push('key-enter');
    }
    if (['CAPS', 'SYMB'].includes(key)) {
      classes.push('key-modifier');
    }
    return classes.join(' ');
  }

  _addStyles() {
    if (document.getElementById('zx-touch-keyboard-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'zx-touch-keyboard-styles';
    style.textContent = `
            .zx-touch-keyboard {
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                background: rgba(0, 0, 0, 0.9);
                padding: 10px;
                z-index: 1000;
                user-select: none;
                -webkit-user-select: none;
                touch-action: manipulation;
            }
            
            .zx-keyboard-toggle {
                position: absolute;
                top: -40px;
                right: 10px;
                background: rgba(0, 0, 0, 0.8);
                border: 2px solid #666;
                border-radius: 5px;
                padding: 5px 10px;
                font-size: 24px;
                cursor: pointer;
            }
            
            .zx-keyboard-layout {
                display: none;
            }
            
            .zx-touch-keyboard.visible .zx-keyboard-layout {
                display: block;
            }
            
            .zx-keyboard-row {
                display: flex;
                justify-content: center;
                margin-bottom: 5px;
                gap: 3px;
            }
            
            .zx-key {
                background: #333;
                color: white;
                border: 2px solid #666;
                border-radius: 5px;
                padding: 10px;
                min-width: 35px;
                font-family: monospace;
                font-size: 14px;
                cursor: pointer;
                touch-action: manipulation;
                -webkit-tap-highlight-color: transparent;
            }
            
            .zx-key:active, .zx-key.active {
                background: #666;
                border-color: #999;
            }
            
            .zx-key.key-special {
                background: #444;
                font-size: 12px;
            }
            
            .zx-key.key-space {
                flex: 2;
            }
            
            .zx-key.key-modifier {
                background: #555;
            }
            
            .zx-key.key-modifier.active {
                background: #888;
                border-color: #bbb;
            }
            
            .zx-key.key-arrow {
                min-width: 45px;
            }
            
            @media (max-width: 600px) {
                .zx-key {
                    padding: 8px;
                    min-width: 28px;
                    font-size: 12px;
                }
                
                .zx-key.key-special {
                    font-size: 10px;
                }
            }
        `;
    document.head.appendChild(style);
  }

  _setupEventHandlers() {
    const toggle = this.element.querySelector('.zx-keyboard-toggle');
    toggle.addEventListener('click', () => this.toggle());

    // Handle key presses
    const keys = this.element.querySelectorAll('.zx-key');
    keys.forEach((keyElement) => {
      // Use touch events for better mobile support
      keyElement.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this._handleKeyDown(keyElement);
      });

      keyElement.addEventListener('touchend', (e) => {
        e.preventDefault();
        this._handleKeyUp(keyElement);
      });

      // Also support mouse for desktop testing
      keyElement.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._handleKeyDown(keyElement);
      });

      keyElement.addEventListener('mouseup', (e) => {
        e.preventDefault();
        this._handleKeyUp(keyElement);
      });

      keyElement.addEventListener('mouseleave', (e) => {
        if (this.activeKeys.has(keyElement)) {
          this._handleKeyUp(keyElement);
        }
      });
    });

    // Prevent context menu on long press
    this.element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _handleKeyDown(keyElement) {
    const key = keyElement.dataset.key;
    if (this.activeKeys.has(keyElement)) {
      return;
    }

    this.activeKeys.add(keyElement);
    keyElement.classList.add('active');

    // Map special keys
    const mappedKey = this._mapKey(key);
    this.spectrum.keyDown(mappedKey);
  }

  _handleKeyUp(keyElement) {
    const key = keyElement.dataset.key;
    if (!this.activeKeys.has(keyElement)) {
      return;
    }

    this.activeKeys.delete(keyElement);
    keyElement.classList.remove('active');

    // Map special keys
    const mappedKey = this._mapKey(key);
    this.spectrum.keyUp(mappedKey);
  }

  _mapKey(key) {
    const keyMap = {
      CAPS: 'Shift',
      SYMB: 'Control',
      SPACE: ' ',
    };
    return keyMap[key] || key;
  }

  _isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;
  }

  show() {
    this.element.classList.add('visible');
    this.isVisible = true;
  }

  hide() {
    this.element.classList.remove('visible');
    this.isVisible = false;

    // Release any stuck keys
    this.activeKeys.forEach((keyElement) => {
      this._handleKeyUp(keyElement);
    });
  }

  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}
