/**
 * Inline Edit Controller for Database Table View
 * Handles inline editing of watch properties: title, watch words, interval, tags
 * Uses Socket.IO for real-time updates
 */

class InlineEdit {
    constructor(table, socket) {
        this.table = table;
        this.socket = socket;
        this.activeEdit = null;
        this.activePopover = null;
        this.csrfToken = document.querySelector('[name=csrf_token]')?.value || '';
        this.allTags = this.collectAllTags();
        this.pendingUpdates = new Map(); // Track pending updates
        this.bindEvents();
        this.bindSocketEvents();
    }

    bindSocketEvents() {
        if (!this.socket) return;

        this.socket.on('update_result', (data) => {
            if (data.success) {
                const pending = this.pendingUpdates.get(data.uuid);
                if (pending) {
                    this.showSuccess(pending.cell);
                    this.pendingUpdates.delete(data.uuid);
                }
            } else {
                const pending = this.pendingUpdates.get(data.uuid);
                if (pending) {
                    this.showError(data.error || 'Update failed');
                    this.pendingUpdates.delete(data.uuid);
                }
            }
        });

        this.socket.on('operation_result', (data) => {
            if (!data.success) {
                this.showError(data.error || 'Operation failed');
            }
        });
    }

    collectAllTags() {
        // Collect all available tags from the tag filter bar
        const tags = [];
        document.querySelectorAll('.tag-filter-bar .button-tag:not(.active)').forEach(btn => {
            const href = btn.getAttribute('href');
            if (href && href.includes('tag=')) {
                const match = href.match(/tag=([a-f0-9-]+)/);
                if (match) {
                    tags.push({
                        uuid: match[1],
                        title: btn.textContent.trim()
                    });
                }
            }
        });
        return tags;
    }

    bindEvents() {
        // Click on editable cell
        this.table.addEventListener('click', (e) => {
            const cell = e.target.closest('.editable-cell');
            if (cell && !this.activeEdit) {
                e.preventDefault();
                e.stopPropagation();
                this.startEdit(cell);
            }
        });

        // Keyboard support for editable cells (Enter/Space to activate)
        this.table.addEventListener('keydown', (e) => {
            const cell = e.target.closest('.editable-cell');
            if (cell && !this.activeEdit && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                this.startEdit(cell);
            }
        });

        // Cancel on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.activeEdit) {
                this.cancelEdit();
            }
        });

        // Close popover when clicking outside
        document.addEventListener('click', (e) => {
            if (this.activePopover && !this.activePopover.contains(e.target) && !e.target.closest('.editable-cell')) {
                this.cancelEdit();
            }
        });

        // Handle pause/mute toggle buttons
        this.table.addEventListener('click', (e) => {
            const btn = e.target.closest('.pause-btn, .notify-btn');
            if (btn) {
                e.preventDefault();
                const row = btn.closest('tr');
                const uuid = row.dataset.watchUuid;
                const op = btn.dataset.op;
                this.toggleOperation(uuid, op, btn, row);
            }
        });

        // Check-all checkbox for database table
        const checkAll = document.getElementById('db-check-all');
        if (checkAll) {
            checkAll.addEventListener('change', () => {
                this.table.querySelectorAll('tbody input[type="checkbox"]').forEach(cb => {
                    cb.checked = checkAll.checked;
                });
            });
        }
    }

    startEdit(cell) {
        const field = cell.dataset.field;
        const row = cell.closest('tr');
        const uuid = row.dataset.watchUuid;

        // Dispatch to field-specific editor
        switch (field) {
            case 'title':
                this.editTitle(cell, uuid, row);
                break;
            case 'watch_words':
                this.editWatchWords(cell, uuid, row);
                break;
            case 'time_between_check':
                this.editInterval(cell, uuid, row);
                break;
            case 'tags':
                this.editTags(cell, uuid, row);
                break;
        }
    }

    editTitle(cell, uuid, row) {
        const titleSpan = cell.querySelector('.title-text');
        const currentValue = row.dataset.watchTitle || titleSpan.textContent.trim();

        cell.classList.add('editing');
        const originalHTML = cell.innerHTML;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'inline-input';
        input.value = currentValue;

        cell.innerHTML = '';
        cell.appendChild(input);
        input.focus();
        input.select();

        this.activeEdit = { cell, uuid, field: 'title', originalHTML, originalValue: currentValue };

        const saveHandler = () => {
            if (this.activeEdit) {
                this.saveTitle(input.value.trim());
            }
        };

        input.addEventListener('blur', saveHandler);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveHandler();
            }
        });
    }

    saveTitle(value) {
        if (!this.activeEdit) return;

        const { cell, uuid, originalHTML, originalValue } = this.activeEdit;

        if (value === originalValue) {
            // No change, just restore
            cell.innerHTML = originalHTML;
            cell.classList.remove('editing');
            this.activeEdit = null;
            return;
        }

        // Show saving state
        cell.innerHTML = '<span class="saving-indicator">Saving...</span>';

        // Track pending update
        this.pendingUpdates.set(uuid, { cell, originalHTML, originalValue });

        // Send update via Socket.IO
        if (this.socket) {
            this.socket.emit('watch_update', {
                uuid: uuid,
                updates: { title: value }
            });

            // Update cell optimistically
            setTimeout(() => {
                cell.innerHTML = originalHTML;
                cell.querySelector('.title-text').textContent = value || originalValue;
                cell.closest('tr').dataset.watchTitle = value;
                cell.classList.remove('editing');
            }, 100);
        } else {
            // Fallback - just update locally
            cell.innerHTML = originalHTML;
            cell.querySelector('.title-text').textContent = value || originalValue;
            cell.closest('tr').dataset.watchTitle = value;
            cell.classList.remove('editing');
            this.showSuccess(cell);
        }

        this.activeEdit = null;
    }

    editWatchWords(cell, uuid, row) {
        const blockWords = row.dataset.blockWords || '';
        const triggerWords = row.dataset.triggerWords || '';

        const popover = this.createPopover(cell, `
            <h4>Watch Words</h4>
            <div class="field-group">
                <label>Block Words (notify when DISAPPEAR)</label>
                <textarea name="block_words" rows="4" placeholder="One word/phrase per line">${this.escapeHtml(blockWords)}</textarea>
                <div class="field-hint">Useful for "Sold Out" alerts - notify when these words disappear</div>
            </div>
            <div class="field-group">
                <label>Trigger Words (notify when APPEAR)</label>
                <textarea name="trigger_words" rows="4" placeholder="One word/phrase per line">${this.escapeHtml(triggerWords)}</textarea>
                <div class="field-hint">Notify when these words appear on the page</div>
            </div>
            <div class="popover-actions">
                <button class="btn-cancel">Cancel</button>
                <button class="btn-save">Save</button>
            </div>
        `);

        this.activeEdit = { cell, uuid, field: 'watch_words' };
        this.activePopover = popover;

        popover.querySelector('.btn-cancel').onclick = () => this.cancelEdit();
        popover.querySelector('.btn-save').onclick = () => {
            const newBlockWords = popover.querySelector('[name=block_words]').value
                .split('\n')
                .map(w => w.trim())
                .filter(w => w);
            const newTriggerWords = popover.querySelector('[name=trigger_words]').value
                .split('\n')
                .map(w => w.trim())
                .filter(w => w);
            this.saveWatchWords(uuid, newBlockWords, newTriggerWords, row, cell);
        };

        // Focus first textarea
        popover.querySelector('textarea').focus();
    }

    saveWatchWords(uuid, blockWords, triggerWords, row, cell) {
        // Track pending update
        this.pendingUpdates.set(uuid, { cell });

        // Send update via Socket.IO
        if (this.socket) {
            this.socket.emit('watch_update', {
                uuid: uuid,
                updates: {
                    block_words: blockWords,
                    trigger_words: triggerWords
                }
            });
        }

        // Update data attributes
        row.dataset.blockWords = blockWords.join('\n');
        row.dataset.triggerWords = triggerWords.join('\n');

        // Update display
        const summary = cell.querySelector('.words-summary');
        if (blockWords.length || triggerWords.length) {
            summary.innerHTML = `
                <span class="block-count" title="Block words">${blockWords.length} block</span>
                <span class="words-sep">/</span>
                <span class="trigger-count" title="Trigger words">${triggerWords.length} trig</span>
            `;
        } else {
            summary.innerHTML = '<span class="no-words">None</span>';
        }

        this.closePopover();
        this.showSuccess(cell);
    }

    editInterval(cell, uuid, row) {
        const useDefault = row.dataset.intervalUseDefault === 'true';
        const hours = parseInt(row.dataset.intervalHours) || 0;
        const minutes = parseInt(row.dataset.intervalMinutes) || 0;

        // Calculate current value in minutes for dropdown
        let currentMinutes = hours * 60 + minutes;

        const popover = this.createPopover(cell, `
            <h4>Check Interval</h4>
            <div class="field-group">
                <label>How often to check</label>
                <select class="interval-dropdown" name="interval">
                    <option value="default" ${useDefault ? 'selected' : ''}>Use Default</option>
                    <option value="1" ${!useDefault && currentMinutes === 1 ? 'selected' : ''}>1 minute</option>
                    <option value="5" ${!useDefault && currentMinutes === 5 ? 'selected' : ''}>5 minutes</option>
                    <option value="15" ${!useDefault && currentMinutes === 15 ? 'selected' : ''}>15 minutes</option>
                    <option value="30" ${!useDefault && currentMinutes === 30 ? 'selected' : ''}>30 minutes</option>
                    <option value="60" ${!useDefault && currentMinutes === 60 ? 'selected' : ''}>1 hour</option>
                    <option value="180" ${!useDefault && currentMinutes === 180 ? 'selected' : ''}>3 hours</option>
                    <option value="360" ${!useDefault && currentMinutes === 360 ? 'selected' : ''}>6 hours</option>
                    <option value="720" ${!useDefault && currentMinutes === 720 ? 'selected' : ''}>12 hours</option>
                    <option value="1440" ${!useDefault && currentMinutes === 1440 ? 'selected' : ''}>24 hours</option>
                    <option value="custom" ${!useDefault && ![1,5,15,30,60,180,360,720,1440].includes(currentMinutes) && currentMinutes > 0 ? 'selected' : ''}>Custom...</option>
                </select>
            </div>
            <div class="field-group custom-interval-group" style="display: ${!useDefault && ![1,5,15,30,60,180,360,720,1440].includes(currentMinutes) && currentMinutes > 0 ? 'block' : 'none'};">
                <label>Custom interval (minutes)</label>
                <input type="number" name="custom_minutes" min="1" value="${currentMinutes || 60}" class="interval-dropdown">
            </div>
            <div class="popover-actions">
                <button class="btn-cancel">Cancel</button>
                <button class="btn-save">Save</button>
            </div>
        `);

        this.activeEdit = { cell, uuid, field: 'time_between_check' };
        this.activePopover = popover;

        const dropdown = popover.querySelector('[name=interval]');
        const customGroup = popover.querySelector('.custom-interval-group');

        dropdown.addEventListener('change', () => {
            customGroup.style.display = dropdown.value === 'custom' ? 'block' : 'none';
        });

        popover.querySelector('.btn-cancel').onclick = () => this.cancelEdit();
        popover.querySelector('.btn-save').onclick = () => {
            let value = dropdown.value;
            if (value === 'custom') {
                value = popover.querySelector('[name=custom_minutes]').value;
            }
            this.saveInterval(uuid, value, row, cell);
        };
    }

    saveInterval(uuid, value, row, cell) {
        let updates;
        if (value === 'default') {
            updates = { time_between_check_use_default: true };
        } else {
            const minutes = parseInt(value);
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            updates = {
                time_between_check_use_default: false,
                time_between_check: {
                    weeks: 0,
                    days: 0,
                    hours: hours,
                    minutes: mins,
                    seconds: 0
                }
            };
        }

        // Track pending update
        this.pendingUpdates.set(uuid, { cell });

        // Send update via Socket.IO
        if (this.socket) {
            this.socket.emit('watch_update', {
                uuid: uuid,
                updates: updates
            });
        }

        // Update data attributes
        if (value === 'default') {
            row.dataset.intervalUseDefault = 'true';
        } else {
            const minutes = parseInt(value);
            row.dataset.intervalUseDefault = 'false';
            row.dataset.intervalHours = Math.floor(minutes / 60);
            row.dataset.intervalMinutes = minutes % 60;
        }

        // Update display
        const intervalText = cell.querySelector('.interval-text');
        if (value === 'default') {
            intervalText.innerHTML = '<span class="interval-default">Default</span>';
        } else {
            const mins = parseInt(value);
            if (mins >= 1440) {
                intervalText.textContent = Math.floor(mins / 1440) + 'd';
            } else if (mins >= 60) {
                intervalText.textContent = Math.floor(mins / 60) + 'h';
            } else {
                intervalText.textContent = mins + 'm';
            }
        }

        this.closePopover();
        this.showSuccess(cell);
    }

    editTags(cell, uuid, row) {
        const currentTags = (row.dataset.tags || '').split(',').filter(t => t);

        let tagsHtml = '<div class="tags-checklist">';
        if (this.allTags.length === 0) {
            tagsHtml += '<div class="no-tags">No tags available</div>';
        } else {
            this.allTags.forEach(tag => {
                const checked = currentTags.includes(tag.uuid) ? 'checked' : '';
                tagsHtml += `
                    <label>
                        <input type="checkbox" name="tags" value="${tag.uuid}" ${checked}>
                        <span class="db-tag-badge">${this.escapeHtml(tag.title)}</span>
                    </label>
                `;
            });
        }
        tagsHtml += '</div>';

        const popover = this.createPopover(cell, `
            <h4>Tags</h4>
            <div class="field-group">
                ${tagsHtml}
            </div>
            <div class="popover-actions">
                <button class="btn-cancel">Cancel</button>
                <button class="btn-save">Save</button>
            </div>
        `);

        this.activeEdit = { cell, uuid, field: 'tags' };
        this.activePopover = popover;

        popover.querySelector('.btn-cancel').onclick = () => this.cancelEdit();
        popover.querySelector('.btn-save').onclick = () => {
            const selectedTags = Array.from(popover.querySelectorAll('[name=tags]:checked'))
                .map(cb => cb.value);
            this.saveTags(uuid, selectedTags, row, cell);
        };
    }

    saveTags(uuid, tagUuids, row, cell) {
        // Track pending update
        this.pendingUpdates.set(uuid, { cell });

        // Send update via Socket.IO
        if (this.socket) {
            this.socket.emit('watch_update', {
                uuid: uuid,
                updates: { tags: tagUuids }
            });
        }

        // Update data attribute
        row.dataset.tags = tagUuids.join(',');

        // Update display - get tag titles from our collected tags
        const tagsList = cell.querySelector('.tags-list');
        if (tagUuids.length) {
            const badges = tagUuids.map(tagUuid => {
                const tag = this.allTags.find(t => t.uuid === tagUuid);
                if (tag) {
                    return `<span class="db-tag-badge">${this.escapeHtml(tag.title)}</span>`;
                }
                return '';
            }).filter(b => b).join('');
            tagsList.innerHTML = badges || '<span class="no-tags">-</span>';
        } else {
            tagsList.innerHTML = '<span class="no-tags">-</span>';
        }

        this.closePopover();
        this.showSuccess(cell);
    }

    toggleOperation(uuid, op, btn, row) {
        // Use Socket.IO for toggle operations (same as existing ajax-op)
        if (this.socket) {
            // Map unpause/unmute to pause/mute (the handler toggles)
            let socketOp = op;
            if (op === 'unpause') socketOp = 'pause';
            if (op === 'unmute') socketOp = 'mute';

            this.socket.emit('watch_operation', {
                op: socketOp,
                uuid: uuid
            });
        }

        // Toggle the UI state optimistically
        if (op === 'pause') {
            row.classList.add('paused');
            btn.dataset.op = 'unpause';
            btn.innerHTML = '&#9654;'; // Play icon
            btn.title = 'Unpause';
            // Update status
            const statusDot = row.querySelector('.status-dot');
            const statusText = row.querySelector('.status-text');
            if (statusDot) statusDot.className = 'status-dot status-paused';
            if (statusText) statusText.textContent = 'Paused';
        } else if (op === 'unpause') {
            row.classList.remove('paused');
            btn.dataset.op = 'pause';
            btn.innerHTML = '&#10074;&#10074;'; // Pause icon
            btn.title = 'Pause';
            // Update status back to OK
            const statusDot = row.querySelector('.status-dot');
            const statusText = row.querySelector('.status-text');
            if (statusDot) statusDot.className = 'status-dot status-ok';
            if (statusText) statusText.textContent = 'OK';
        } else if (op === 'mute') {
            row.classList.add('notification_muted');
            btn.dataset.op = 'unmute';
            btn.innerHTML = '<span class="notify-muted">&#128277;</span>';
            btn.title = 'Unmute notifications';
        } else if (op === 'unmute') {
            row.classList.remove('notification_muted');
            btn.dataset.op = 'mute';
            btn.innerHTML = '<span class="notify-active">&#128276;</span>';
            btn.title = 'Mute notifications';
        }
    }

    createPopover(cell, content) {
        // Remove any existing popover
        this.closePopover();

        const popover = document.createElement('div');
        popover.className = 'edit-popover';
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-modal', 'true');
        popover.setAttribute('aria-label', 'Edit field');
        popover.innerHTML = content;

        // Add keyboard handler for Escape to close
        popover.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.cancelEdit();
            }
            // Trap focus within popover
            if (e.key === 'Tab') {
                const focusable = popover.querySelectorAll('button, input, textarea, select, [tabindex]:not([tabindex="-1"])');
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        });

        // Position the popover
        document.body.appendChild(popover);

        const rect = cell.getBoundingClientRect();
        const popoverRect = popover.getBoundingClientRect();

        let left = rect.left;
        let top = rect.bottom + 8;

        // Adjust if going off screen
        if (left + popoverRect.width > window.innerWidth) {
            left = window.innerWidth - popoverRect.width - 16;
        }
        if (top + popoverRect.height > window.innerHeight) {
            top = rect.top - popoverRect.height - 8;
        }

        popover.style.left = left + 'px';
        popover.style.top = top + 'px';

        return popover;
    }

    closePopover() {
        if (this.activePopover) {
            this.activePopover.remove();
            this.activePopover = null;
        }
        // Restore focus to the edited cell
        if (this.activeEdit && this.activeEdit.cell) {
            this.activeEdit.cell.focus();
        }
        this.activeEdit = null;
    }

    cancelEdit() {
        if (this.activeEdit) {
            const { cell, originalHTML } = this.activeEdit;
            if (originalHTML) {
                cell.innerHTML = originalHTML;
                cell.classList.remove('editing');
            }
        }
        this.closePopover();
    }

    showSuccess(cell) {
        cell.classList.add('save-success');
        setTimeout(() => cell.classList.remove('save-success'), 600);
    }

    showError(message) {
        const toast = document.createElement('div');
        toast.className = 'toast toast-error';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize when DOM is ready - wait for Socket.IO to be available
document.addEventListener('DOMContentLoaded', () => {
    const table = document.getElementById('watch-database');
    if (table) {
        // Wait a bit for Socket.IO to initialize (it's loaded via realtime.js)
        const initInlineEdit = () => {
            // Get socket from global scope (set by realtime.js)
            const socket = window.watchSocket || (typeof io !== 'undefined' ? io() : null);
            new InlineEdit(table, socket);
        };

        // If Socket.IO is already available, init immediately; otherwise wait
        if (typeof io !== 'undefined') {
            // Give realtime.js a moment to set up the socket
            setTimeout(initInlineEdit, 500);
        } else {
            // Fallback: init without socket after a delay
            setTimeout(initInlineEdit, 1000);
        }
    }
});
