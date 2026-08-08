// Small custom dialogs (replaces native confirm/prompt).

function base(cls) {
  const root = document.getElementById('modal-root');
  const dlg = document.createElement('dialog');
  dlg.className = cls;
  root.appendChild(dlg);
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 150));
  return dlg;
}

// buttons: [{ label, value, kind: 'primary'|'danger'|'ghost' }]
// checkbox (optional): { label, checked } — when present the promise resolves
// { value, checked } instead of the bare value.
export function choiceDialog({ title, message, buttons, showCancel = true, checkbox }) {
  return new Promise((resolve) => {
    const dlg = base('choice');
    let result = null;
    const btnsHtml = buttons.map((b, i) =>
      `<button class="${b.kind === 'primary' ? 'btn-primary' : 'btn-ghost'}${b.kind === 'danger' ? ' danger' : ''}" data-i="${i}"></button>`
    ).join('');
    dlg.innerHTML = `
      <div class="choice-card">
        <h2></h2>
        ${message ? '<p class="muted choice-msg"></p>' : ''}
        ${checkbox ? `<label class="row check choice-check"><input type="checkbox" ${checkbox.checked ? 'checked' : ''}/><span></span></label>` : ''}
        <div class="choice-btns">${btnsHtml}</div>
        ${showCancel ? '<button class="btn-ghost choice-cancel">Cancel</button>' : ''}
      </div>`;
    dlg.querySelector('h2').textContent = title;
    if (message) dlg.querySelector('.choice-msg').textContent = message;
    if (checkbox) dlg.querySelector('.choice-check span').textContent = checkbox.label;
    dlg.querySelectorAll('[data-i]').forEach((btn) => {
      btn.textContent = buttons[+btn.dataset.i].label;
      btn.onclick = () => { result = buttons[+btn.dataset.i].value; dlg.close(); };
    });
    dlg.querySelector('.choice-cancel')?.addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => {
      if (!checkbox) return resolve(result);
      resolve({ value: result, checked: !!dlg.querySelector('.choice-check input')?.checked });
    });
    dlg.showModal();
  });
}

export function confirmDialog({ title, message, confirmLabel = 'Delete' }) {
  return choiceDialog({
    title, message, showCancel: true,
    buttons: [{ label: confirmLabel, value: true, kind: 'danger' }],
  }).then((v) => !!v);
}

export function promptDialog({ title, message, placeholder = '', value = '', confirmLabel = 'Save' }) {
  return new Promise((resolve) => {
    const dlg = base('choice');
    let result = null;
    dlg.innerHTML = `
      <form method="dialog" class="choice-card">
        <h2></h2>
        ${message ? '<p class="muted choice-msg"></p>' : ''}
        <input class="prompt-input" autocomplete="off"/>
        <div class="editor-actions">
          <button type="button" class="btn-ghost choice-cancel">Cancel</button>
          <button type="submit" class="btn-primary"></button>
        </div>
      </form>`;
    dlg.querySelector('h2').textContent = title;
    if (message) dlg.querySelector('.choice-msg').textContent = message;
    const input = dlg.querySelector('.prompt-input');
    input.placeholder = placeholder;
    input.value = value;
    dlg.querySelector('[type=submit]').textContent = confirmLabel;
    dlg.querySelector('form').onsubmit = () => { result = input.value.trim(); };
    dlg.querySelector('.choice-cancel').onclick = () => dlg.close();
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => resolve(result));
    dlg.showModal();
    input.focus();
  });
}
