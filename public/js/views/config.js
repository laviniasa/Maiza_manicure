import { api } from '../api.js';
import { getSettings, saveSettings, getUser } from '../data.js';
import { esc, fillTemplate, toast } from '../utils.js';

export default async function config(view, _param, stillCurrent) {
  const [settings, user] = await Promise.all([getSettings(), getUser()]);
  if (!stillCurrent()) return;

  view.innerHTML = `
    <h1>Ajustes</h1>

    <form class="card form" id="settings-form" novalidate>
      <h2>Studio</h2>
      <label>Nome do studio<input name="business_name" required value="${esc(settings.business_name)}"></label>
      <label>Mensagem de retorno (WhatsApp)
        <textarea name="return_message" rows="4" required>${esc(settings.return_message)}</textarea>
      </label>
      <p class="small muted">Use <code>{nome}</code> para o primeiro nome da cliente e <code>{servico}</code> para o último serviço.</p>
      <div class="preview"><span class="small muted">Prévia</span><p id="preview"></p></div>
      <button class="btn btn-primary" type="submit">Salvar</button>
    </form>

    <form class="card form" id="password-form" novalidate>
      <h2>Conta</h2>
      <p class="muted small">Conectada como ${esc(user?.email ?? '')}</p>
      <label>Nova senha<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
      <button class="btn btn-ghost" type="submit">Alterar senha</button>
    </form>

    <button class="btn btn-ghost btn-block btn-danger-text" id="logout">Sair da conta</button>
    <p class="small muted center">Para instalar: no celular, abra o menu do navegador e toque em “Adicionar à tela inicial”.</p>`;

  const form = view.querySelector('#settings-form');
  const preview = view.querySelector('#preview');
  const updatePreview = () => {
    preview.textContent = fillTemplate(form.return_message.value, { nome: 'Ana', servico: 'unha em gel' });
  };
  updatePreview();
  form.return_message.addEventListener('input', updatePreview);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    try {
      const saved = await saveSettings({
        business_name: form.business_name.value.trim(),
        return_message: form.return_message.value.trim(),
      });
      const nameEl = document.getElementById('business-name');
      if (nameEl) nameEl.textContent = saved.business_name;
      toast('Ajustes salvos');
    } catch (err) { toast(err.message, 'error'); }
  });

  const pw = view.querySelector('#password-form');
  pw.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pw.reportValidity()) return;
    try {
      await api('/password', { method: 'POST', body: { password: pw.password.value } });
      pw.reset();
      toast('Senha alterada');
    } catch (err) { toast(err.message, 'error'); }
  });

  view.querySelector('#logout').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    window.dispatchEvent(new Event('auth:expired'));
  });
}
