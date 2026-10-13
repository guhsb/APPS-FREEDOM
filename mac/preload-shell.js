'use strict';
// Barra lateral (Helpdesk / Site / Painel) e botões dos painéis.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('Barra', {
  escolher: aba => ipcRenderer.send('barra', 'aba', aba),
  painel: id => ipcRenderer.send('barra', 'painel', id),
  aoMudar: f => ipcRenderer.on('barra-estado', (e, s) => f(s))
});
