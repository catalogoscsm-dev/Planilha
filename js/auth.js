/* ============================================================
   auth.js — autenticação e sessão (Supabase Auth)
   ============================================================ */

import supabase from './supabaseClient.js';

/* Retorna a sessão atual (ou null). */
export async function getSessao() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/* Retorna o usuário logado (ou null). */
export async function usuarioAtual() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

/* Login por e-mail/senha. Retorna { data, error }. */
export async function login(email, senha) {
  return supabase.auth.signInWithPassword({ email, password: senha });
}

/* Cadastro por e-mail/senha. Retorna { data, error }. */
export async function cadastrar(email, senha) {
  return supabase.auth.signUp({ email, password: senha });
}

/* Logout e volta para o login. */
export async function logout() {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}

/* Guarda de rota: se não houver sessão, manda para o login.
   Retorna a sessão quando autenticado. */
export async function exigirLogin() {
  const sessao = await getSessao();
  if (!sessao) {
    window.location.href = 'index.html';
    return null;
  }
  return sessao;
}
