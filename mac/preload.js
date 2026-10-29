'use strict';
// Ponte das telas (as mesmas do celular) com o app: window.App.metodo(...) — igual ao Android e ao Windows.
// As chamadas são síncronas (ipcRenderer.sendSync), como a ponte do Android.
const { contextBridge, ipcRenderer } = require('electron');
const METODOS = ['nome', 'plataforma', 'tema', 'definirTema', 'dadosPainel', 'dados', 'atualizar', 'buscarPainel', 'entrar', 'sair', 'helpdesk', 'verificarHelpdesk',
  'configurarHelpdesk', 'abrirSite', 'siteDireto', 'aba', 'exportar', 'abrirTela', 'voltar', 'liberarBateria', 'configurarNotificacoes', 'configurarSom',
  'testarNotificacao', 'carregarChamado', 'responderChamado', 'assumirChamado', 'operarChamado', 'anexosChamado', 'anexarChamado',
  'baixarAnexo', 'enviarAnexoNovo', 'api', 'atualizarApp', 'atualizarPeloNavegador', 'copiarDiagnostico', 'copiarImagem', 'copiarImagens', 'lerDado', 'gravarDado', 'salvarCopia', 'shell', 'irAba', 'irSub', 'acaoShell', 'sino', 'marcarLidos', 'subAbas', 'painelShell', 'salvarImagem', 'configurarAvisoMeta', 'controle'];
const App = {};
for (const m of METODOS) App[m] = (...a) => ipcRenderer.sendSync('app', m, a);
contextBridge.exposeInMainWorld('App', App);
