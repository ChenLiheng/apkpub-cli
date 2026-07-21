/** 生成配置编辑页面的完整 HTML（自包含，无外部依赖） */
export function renderConfigUiPage(): string {
  return PAGE_HTML;
}

const PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>apkpub 配置编辑</title>
<style>
  :root {
    --bg: #f5f6f8;
    --card: #ffffff;
    --border: #e2e5ea;
    --text: #1f2430;
    --muted: #6b7280;
    --primary: #2f6fed;
    --primary-dark: #2559c5;
    --danger: #e5484d;
    --ok: #12894a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
  }
  header {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--card);
    border-bottom: 1px solid var(--border);
    padding: 14px 24px;
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  header h1 { font-size: 16px; margin: 0; }
  header .app-id { color: var(--muted); font-family: monospace; }
  header .spacer { flex: 1; }
  main { max-width: 960px; margin: 0 auto; padding: 24px; }
  .section {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 20px;
    margin-bottom: 20px;
  }
  .section > h2 {
    font-size: 15px;
    margin: 0 0 14px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .field { margin-bottom: 12px; }
  .field > label { display: block; color: var(--muted); margin-bottom: 4px; font-size: 12px; }
  .input-row { display: flex; gap: 6px; align-items: stretch; }
  input[type=text], input[type=password], textarea, select {
    flex: 1;
    width: 100%;
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 13px;
    background: #fff;
    color: var(--text);
    font-family: inherit;
  }
  textarea { min-height: 60px; resize: vertical; }
  input:focus, textarea:focus, select:focus { outline: none; border-color: var(--primary); }
  button {
    cursor: pointer;
    border: 1px solid var(--border);
    background: #fff;
    color: var(--text);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 13px;
  }
  button:hover { background: #f0f2f5; }
  button.primary { background: var(--primary); border-color: var(--primary); color: #fff; }
  button.primary:hover { background: var(--primary-dark); }
  button.danger { color: var(--danger); border-color: transparent; background: transparent; }
  button.danger:hover { background: #fdecec; }
  button.copy { padding: 6px 10px; white-space: nowrap; }
  button.copy.copied { color: var(--ok); border-color: var(--ok); }
  .channel {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
    margin-bottom: 14px;
    background: #fafbfc;
  }
  .channel-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
  .channel-head .name { flex: 1; min-width: 160px; }
  .badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: #eef2ff;
    color: var(--primary);
  }
  .badge.custom { background: #fff1e6; color: #c2560b; }
  .kv-row { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
  .kv-row .k { flex: 0 0 32%; }
  .kv-row .v { flex: 1; }
  .subgroup { border-left: 3px solid var(--border); padding-left: 12px; margin: 10px 0; }
  .toggle { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
  .add-bar { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .hint { color: var(--muted); font-size: 12px; margin: 4px 0 10px; }
  #status { font-size: 13px; }
  #status.ok { color: var(--ok); }
  #status.err { color: var(--danger); }
  .row-2 { display: flex; gap: 16px; flex-wrap: wrap; }
  .row-2 > .field { flex: 1; min-width: 220px; }
</style>
</head>
<body>
<header>
  <h1>apkpub 配置编辑</h1>
  <span class="app-id" id="appId"></span>
  <span class="spacer"></span>
  <label class="toggle"><input type="checkbox" id="mask" /> 遮蔽密钥显示</label>
  <button id="reload">重新加载</button>
  <button class="primary" id="save">保存到本地</button>
  <span id="status"></span>
</header>
<main id="app"></main>
<script>
(function () {
  var token = new URLSearchParams(location.search).get('token') || '';
  var state = { model: null, metas: [] };
  var mask = false;

  var appEl = document.getElementById('app');
  var statusEl = document.getElementById('status');

  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = kind || '';
  }

  function api(path, options) {
    var opts = options || {};
    var sep = path.indexOf('?') >= 0 ? '&' : '?';
    return fetch(path + sep + 'token=' + encodeURIComponent(token), opts).then(function (r) {
      return r.json().then(function (data) {
        return { ok: r.ok, data: data };
      });
    });
  }

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') el[k] = attrs[k];
      else if (k === 'checked' || k === 'disabled') el[k] = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return el;
  }

  function copyText(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value);
    }
    var ta = document.createElement('textarea');
    ta.value = value;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  function isSecretName(name) {
    var n = (name || '').toLowerCase();
    return ['secret', 'privatekey', 'signkey', 'password', 'token', 'accesskeysecret'].some(function (k) {
      return n.indexOf(k) >= 0;
    });
  }

  // 带复制按钮的输入框，直接绑定到 obj[key]
  function boundInput(obj, key, opts) {
    opts = opts || {};
    var secret = opts.secret && mask;
    var input = h(opts.textarea ? 'textarea' : 'input', {
      type: secret ? 'password' : 'text',
      value: obj[key] == null ? '' : String(obj[key]),
      placeholder: opts.placeholder || '',
      oninput: function () { obj[key] = input.value; }
    });
    var copy = h('button', {
      class: 'copy',
      text: '复制',
      onclick: function () {
        copyText(input.value).then(function () {
          copy.textContent = '已复制';
          copy.classList.add('copied');
          setTimeout(function () { copy.textContent = '复制'; copy.classList.remove('copied'); }, 1200);
        });
      }
    });
    return h('div', { class: 'input-row' }, [input, copy]);
  }

  function boundCheckbox(obj, key) {
    return h('input', {
      type: 'checkbox',
      checked: !!obj[key],
      onchange: function (e) { obj[key] = e.target.checked; }
    });
  }

  function boundSelect(obj, key, options) {
    var sel = h('select', {
      onchange: function () { obj[key] = sel.value; render(); }
    });
    options.forEach(function (o) {
      var opt = h('option', { value: o.value, text: o.label });
      if (obj[key] === o.value) opt.selected = true;
      sel.appendChild(opt);
    });
    return sel;
  }

  function field(labelText, control) {
    return h('div', { class: 'field' }, [h('label', { text: labelText }), control]);
  }

  // 通用键值编辑器（name/value 或 key/value）
  function kvEditor(list, keyName, valName, opts) {
    opts = opts || {};
    var wrap = h('div', {});
    list.forEach(function (item, idx) {
      var kInput = h('input', {
        type: 'text',
        class: 'k',
        value: item[keyName] == null ? '' : String(item[keyName]),
        placeholder: opts.keyPlaceholder || '键',
        oninput: function (e) { item[keyName] = e.target.value; }
      });
      var secret = opts.secretByKey && isSecretName(item[keyName]) && mask;
      var vInput = h('input', {
        type: secret ? 'password' : 'text',
        class: 'v',
        value: item[valName] == null ? '' : String(item[valName]),
        placeholder: opts.valPlaceholder || '值',
        oninput: function (e) { item[valName] = e.target.value; }
      });
      var copy = h('button', {
        class: 'copy', text: '复制',
        onclick: function () {
          copyText(vInput.value).then(function () {
            copy.textContent = '已复制'; copy.classList.add('copied');
            setTimeout(function () { copy.textContent = '复制'; copy.classList.remove('copied'); }, 1200);
          });
        }
      });
      var del = h('button', {
        class: 'danger', text: '删除',
        onclick: function () { list.splice(idx, 1); render(); }
      });
      wrap.appendChild(h('div', { class: 'kv-row' }, [kInput, vInput, copy, del]));
    });
    var add = h('button', {
      text: '+ 添加',
      onclick: function () {
        var row = {};
        row[keyName] = '';
        row[valName] = '';
        list.push(row);
        render();
      }
    });
    wrap.appendChild(h('div', { class: 'add-bar' }, [add]));
    return wrap;
  }

  function metaByName(name) {
    for (var i = 0; i < state.metas.length; i++) {
      if (state.metas[i].name === name) return state.metas[i];
    }
    return null;
  }

  function usedChannelNames() {
    return state.model.channels.map(function (c) { return c.name; });
  }

  function renderMarketChannel(ch) {
    var body = h('div', {});
    body.appendChild(h('div', { class: 'hint' }, '渠道参数（名称 / 值），密钥可填明文、\${ENV} 环境变量或 enc: 密文'));
    body.appendChild(kvEditor(ch.params, 'name', 'value', {
      keyPlaceholder: '参数名', valPlaceholder: '参数值', secretByKey: true
    }));
    return body;
  }

  function renderCustomChannel(ch) {
    var body = h('div', {});
    body.appendChild(h('div', { class: 'row-2' }, [
      field('上传类型 uploadType', boundSelect(ch, 'uploadType', [
        { value: 'oss', label: 'oss' }, { value: 'http', label: 'http' }
      ])),
      field('文件名匹配 fileNameIdentify', boundInput(ch, 'fileNameIdentify'))
    ]));
    body.appendChild(h('div', { class: 'row-2' }, [
      field('endpoint', boundInput(ch, 'endpoint')),
      field('bucket', boundInput(ch, 'bucket'))
    ]));

    // 鉴权
    var authWrap = h('div', { class: 'subgroup' });
    authWrap.appendChild(h('label', { class: 'toggle' }, [boundCheckbox(ch, 'authEnabled'), ' 启用鉴权 auth']));
    authWrap.lastChild.querySelector('input').onchange = function (e) { ch.authEnabled = e.target.checked; render(); };
    if (ch.authEnabled) {
      authWrap.appendChild(field('鉴权模式 mode', boundSelect(ch, 'authMode', [
        { value: 'ak', label: 'ak（AccessKey）' }, { value: 'sts', label: 'sts（STS 令牌）' }
      ])));
      if (ch.authMode === 'ak') {
        authWrap.appendChild(field('accessKeyId', boundInput(ch.ak, 'accessKeyId')));
        authWrap.appendChild(field('accessKeySecret', boundInput(ch.ak, 'accessKeySecret', { secret: true })));
      } else {
        authWrap.appendChild(field('stsTokenUrl', boundInput(ch.sts, 'stsTokenUrl')));
        authWrap.appendChild(field('signKey', boundInput(ch.sts, 'signKey', { secret: true })));
        authWrap.appendChild(field('contextB', boundInput(ch.sts, 'contextB')));
      }
    }
    body.appendChild(authWrap);

    body.appendChild(h('div', { class: 'row-2' }, [
      field('uploadUrl', boundInput(ch, 'uploadUrl')),
      field('method', boundSelect(ch, 'method', [
        { value: '', label: '(不设置)' }, { value: 'PUT', label: 'PUT' }, { value: 'POST', label: 'POST' }
      ]))
    ]));
    body.appendChild(field('formField', boundInput(ch, 'formField')));
    body.appendChild(field('objectKeyTemplate', boundInput(ch, 'objectKeyTemplate')));
    body.appendChild(field('downloadUrlTemplate', boundInput(ch, 'downloadUrlTemplate')));

    body.appendChild(h('label', { text: '请求头 headers' }));
    body.appendChild(kvEditor(ch.headers, 'key', 'value', { keyPlaceholder: 'Header 名', valPlaceholder: 'Header 值' }));

    body.appendChild(h('label', { text: '渠道参数 params' }));
    body.appendChild(kvEditor(ch.params, 'name', 'value', { keyPlaceholder: '参数名', valPlaceholder: '参数值', secretByKey: true }));
    return body;
  }

  function renderChannel(ch, idx) {
    var card = h('div', { class: 'channel' });
    var nameInput = h('input', {
      type: 'text', class: 'name', value: ch.name,
      placeholder: '渠道名称',
      oninput: function (e) { ch.name = e.target.value; }
    });
    var head = h('div', { class: 'channel-head' }, [
      h('label', { class: 'toggle' }, [boundCheckbox(ch, 'enable'), ' 启用']),
      nameInput,
      h('span', { class: 'badge' + (ch.type === 'custom' ? ' custom' : ''), text: ch.type }),
      h('button', { class: 'danger', text: '删除渠道', onclick: function () { state.model.channels.splice(idx, 1); render(); } })
    ]);
    card.appendChild(head);
    card.appendChild(ch.type === 'custom' ? renderCustomChannel(ch) : renderMarketChannel(ch));
    return card;
  }

  function newMarketChannel(meta) {
    var params = (meta.credentialFields || []).map(function (f) {
      return { name: f.name, value: f.name === 'fileNameIdentify' ? meta.fileNameIdentify : '' };
    });
    return { type: 'market', name: meta.name, enable: true, params: params };
  }

  function newCustomChannel() {
    var base = 'custom';
    var name = base;
    var n = 1;
    var used = usedChannelNames();
    while (used.indexOf(name) >= 0) { name = base + n; n++; }
    return {
      type: 'custom', name: name, enable: true, uploadType: 'oss',
      fileNameIdentify: '', endpoint: '', bucket: '',
      authEnabled: false, authMode: 'ak',
      ak: { accessKeyId: '', accessKeySecret: '' },
      sts: { stsTokenUrl: '', signKey: '', contextB: '{}' },
      uploadUrl: '', method: '', headers: [], formField: '',
      objectKeyTemplate: '', downloadUrlTemplate: '', params: []
    };
  }

  function renderAddChannelBar() {
    var used = usedChannelNames();
    var sel = h('select', {});
    var options = [];
    state.metas.forEach(function (m) {
      if (used.indexOf(m.name) < 0) options.push({ value: 'market:' + m.name, label: '市场渠道 - ' + m.label });
    });
    options.push({ value: 'custom', label: '自定义渠道（OSS / HTTP）' });
    options.forEach(function (o) { sel.appendChild(h('option', { value: o.value, text: o.label })); });
    var add = h('button', {
      text: '+ 添加渠道',
      onclick: function () {
        var v = sel.value;
        if (v === 'custom') {
          state.model.channels.push(newCustomChannel());
        } else if (v.indexOf('market:') === 0) {
          var meta = metaByName(v.slice(7));
          if (meta) state.model.channels.push(newMarketChannel(meta));
        }
        render();
      }
    });
    return h('div', { class: 'add-bar' }, [sel, add]);
  }

  function render() {
    if (!state.model) return;
    document.getElementById('appId').textContent = state.model.applicationId;
    appEl.innerHTML = '';

    // 应用基础信息
    var appSection = h('div', { class: 'section' }, [h('h2', { text: '应用信息' })]);
    appSection.appendChild(field('应用显示名称 name', boundInput(state.model, 'name')));
    appSection.appendChild(field('包名 applicationId（不可修改）',
      h('input', { type: 'text', value: state.model.applicationId, disabled: true })));
    appSection.appendChild(h('label', { class: 'toggle' }, [boundCheckbox(state.model, 'enableChannel'), ' 启用渠道分发 enableChannel']));
    appEl.appendChild(appSection);

    // 渠道
    var chSection = h('div', { class: 'section' }, [h('h2', { text: '渠道配置' })]);
    state.model.channels.forEach(function (ch, idx) { chSection.appendChild(renderChannel(ch, idx)); });
    chSection.appendChild(renderAddChannelBar());
    appEl.appendChild(chSection);

    // 扩展信息
    var extSection = h('div', { class: 'section' }, [h('h2', { text: '扩展信息 extension' })]);
    var ext = state.model.extension;
    extSection.appendChild(field('更新说明 updateDesc', boundInput(ext, 'updateDesc', { textarea: true })));
    extSection.appendChild(field('APK 目录 apkDir', boundInput(ext, 'apkDir')));
    extSection.appendChild(h('label', { text: '自定义链接 urls' }));
    extSection.appendChild(kvEditor(ext.urls, 'key', 'value', { keyPlaceholder: '渠道/名称', valPlaceholder: 'URL' }));
    extSection.appendChild(h('label', { text: '上次版本号 lastVersionCode（数值）' }));
    extSection.appendChild(kvEditor(ext.lastVersionCode, 'key', 'value', { keyPlaceholder: '渠道', valPlaceholder: '数字' }));
    extSection.appendChild(h('label', { text: '上次版本名 lastVersionName' }));
    extSection.appendChild(kvEditor(ext.lastVersionName, 'key', 'value', { keyPlaceholder: '渠道', valPlaceholder: '版本名' }));
    appEl.appendChild(extSection);
  }

  function load() {
    setStatus('加载中...', '');
    api('/api/meta').then(function (res) {
      if (!res.ok || !res.data.ok) {
        setStatus((res.data.error && res.data.error.message) || '加载失败', 'err');
        return;
      }
      state.model = res.data.model;
      state.metas = res.data.channelMetas || [];
      setStatus('', '');
      render();
    }).catch(function (e) { setStatus('加载失败: ' + e, 'err'); });
  }

  function save() {
    setStatus('保存中...', '');
    api('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.model)
    }).then(function (res) {
      if (!res.ok || !res.data.ok) {
        setStatus((res.data.error && res.data.error.message) || '保存失败', 'err');
        return;
      }
      state.model = res.data.model;
      setStatus('已保存 ✓', 'ok');
      render();
    }).catch(function (e) { setStatus('保存失败: ' + e, 'err'); });
  }

  document.getElementById('save').onclick = save;
  document.getElementById('reload').onclick = load;
  document.getElementById('mask').onchange = function (e) { mask = e.target.checked; render(); };

  load();
})();
</script>
</body>
</html>`;
