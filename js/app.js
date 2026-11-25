const paginas = {
    inicio: ["Visão geral", "Início"],
    agendamento: ["Merenda", "Agendamento de lanches"],
    "entrega-lanche": ["Merenda", "Entrega de lanches"],
    cardapios: ["Merenda", "Cardápios"],
    lanches: ["Merenda", "Lanches"],
    alimentos: ["Estoque", "Alimentos"],
    produtos: ["Estoque", "Produtos"],
    fornecedores: ["Compras", "Fornecedores"],
    empenhos: ["Compras", "Empenhos"],
    "agenda-empenho": ["Compras", "Entregas de empenho"],
    recebimento: ["Compras", "Recebimento"]
};

const referencias = {
    inteiro: { nome: "Inteiro ou fração", classe: "ref-inteiro" },
    unidade_base: { nome: "Unidade de medida base", classe: "ref-base" },
    subitens: { nome: "Subitens", classe: "ref-subitens" }
};

const estadosEntrega = {
    agendado: ["Agendado", "azul"],
    entrega_parcial: ["Entrega parcial", "laranja"],
    entrega_total: ["Entrega total", "verde"],
    finalizado: ["Finalizado", "cinza"]
};

const turnos = { manha: "Manhã", tarde: "Tarde" };

const nomesDias = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];

const formularios = {
    lanche_agendado: { salvo: "Lanche agendado", excluido: "Agendamento excluído", preencher: preencherAgendamento, salvar: salvarSimples },
    cardapio: { salvo: "Cardápio salvo", excluido: "Cardápio excluído", preencher: preencherCardapio, salvar: salvarCardapio },
    lanche: { salvo: "Lanche salvo", excluido: "Lanche excluído", preencher: preencherLanche, salvar: salvarLanche },
    alimento: { salvo: "Alimento salvo", excluido: "Alimento excluído", preencher: preencherAlimento, salvar: salvarSimples },
    produto: { salvo: "Produto salvo", excluido: "Produto excluído", preencher: preencherProduto, salvar: salvarProduto },
    fornecedor: { salvo: "Fornecedor salvo", excluido: "Fornecedor excluído", preencher: preencherSimples, salvar: salvarSimples },
    empenho: { salvo: "Empenho registrado", excluido: "Empenho excluído", preencher: preencherEmpenho, salvar: salvarEmpenho },
    agenda_entrega_empenho: { salvo: "Entregas solicitadas", excluido: "Solicitação excluída", preencher: preencherSolicitacao, salvar: salvarSolicitacao },
    perda: { salvo: "Perda registrada. O estoque local do produto foi atualizado.", excluido: "Registro de perda excluído. A quantidade voltou ao estoque local.", preencher: preencherPerda, salvar: salvarSimples }
};

const el = id => document.getElementById(id);
const buscar = (lista, id) => lista.find(item => item.id === id);
const num = valor => valor.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const arredondarCima = valor => Math.ceil(valor - 1e-9);
const precisao = valor => Math.round(valor * 1000) / 1000;
const formatarData = iso => iso.split("-").reverse().join("/");
const diaMes = iso => `${iso.slice(8)}/${iso.slice(5, 7)}`;
const mesCurto = iso => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
const maiuscula = texto => texto ? texto[0].toUpperCase() + texto.slice(1) : "";
const esc = texto => String(texto ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const icone = nome => `<span class="icone" aria-hidden="true">${nome}</span>`;
const badge = (texto, cor) => `<span class="badge badge-${cor}">${texto}</span>`;
const vazio = (nomeIcone, texto, classe = "") => `<div class="vazio ${classe}">${icone(nomeIcone)}<p>${texto}</p></div>`;
const linhaVazia = (colunas, nomeIcone, texto) => `<tr class="linha-vazia"><td colspan="${colunas}">${vazio(nomeIcone, texto)}</td></tr>`;
const opcoes = (lista, textoVazio) => (textoVazio ? `<option value="">${textoVazio}</option>` : "") + lista.map(([valor, texto]) => `<option value="${valor}">${esc(texto)}</option>`).join("");
const ordenado = (lista, chave) => [...lista].sort((a, b) => chave(a).localeCompare(chave(b)));
const sincronizar = area => area.querySelectorAll("select[onchange]").forEach(select => select.dispatchEvent(new Event("change")));
const botoesLinha = (tabela, id) => `<button class="btn-icone" data-editar="${tabela}" data-id="${id}" title="Editar" aria-label="Editar">${icone("edit")}</button><button class="btn-icone" data-excluir="${tabela}" data-id="${id}" title="Excluir" aria-label="Excluir">${icone("delete")}</button>`;

const dataLocal = data => [data.getFullYear(), data.getMonth() + 1, data.getDate()].map(n => String(n).padStart(2, "0")).join("-");
const hoje = dataLocal(new Date());

const dados = Object.fromEntries(banco.tabelas.map(tabela => [tabela, []]));

let semanaAtual = segundaDaSemana(hoje);
let agendadoSelecionado = null;
let entregaFocoId = null;

function somarDias(iso, dias) {
    const data = new Date(`${iso}T12:00:00`);
    data.setDate(data.getDate() + dias);
    return dataLocal(data);
}

function segundaDaSemana(iso) {
    const data = new Date(`${iso}T12:00:00`);
    return somarDias(iso, -((data.getDay() + 6) % 7));
}

// ---------------------------------------------------------------------------------------------
// Consultas e conversões de unidades

const pendente = entrega => entrega.estado === "agendado" || entrega.estado === "entrega_parcial";
const vigente = empenho => empenho.data_final >= hoje;
const doRegistro = (tabela, campo, id) => dados[tabela].filter(item => item[campo] === id);
const itensCardapio = id => doRegistro("item_cardapio", "fk_cardapio", id);
const itensLanche = id => doRegistro("item_lanche", "fk_lanche", id);
const itensEmpenho = id => doRegistro("item_empenho", "fk_empenho", id);
const porTurno = (a, b) => a.data.localeCompare(b.data) || a.turno.localeCompare(b.turno);

function fatorUnidade(unidadeId) {
    const unidade = buscar(dados.unidade_medida, unidadeId);
    if (!unidade || !unidade.fk_multiplo) return 1;
    const multiplo = buscar(dados.multiplo, unidade.fk_multiplo);
    return multiplo ? multiplo.valor : 1;
}

// Unidades compatíveis (mesma unidade básica, variando apenas o múltiplo/submúltiplo)
function unidadesCompativeis(unidadeId) {
    const base = buscar(dados.unidade_medida, unidadeId);
    if (!base) return [];
    return dados.unidade_medida.filter(u => u.fk_unidade_medida_basica === base.fk_unidade_medida_basica);
}

function converterEntreUnidades(valor, unidadeOrigemId, unidadeDestinoId) {
    if (!unidadeOrigemId || !unidadeDestinoId || unidadeOrigemId === unidadeDestinoId) return valor;
    return precisao((valor * fatorUnidade(unidadeOrigemId)) / fatorUnidade(unidadeDestinoId));
}

function siglaUnidade(id) {
    const unidade = buscar(dados.unidade_medida, id);
    const multiplo = buscar(dados.multiplo, unidade.fk_multiplo);
    return `${multiplo ? multiplo.sigla : ""}${buscar(dados.unidade_medida_basica, unidade.fk_unidade_medida_basica).sigla}`;
}

function nomeUnidade(id) {
    const unidade = buscar(dados.unidade_medida, id);
    const multiplo = buscar(dados.multiplo, unidade.fk_multiplo);
    return `${maiuscula(`${multiplo ? multiplo.nome : ""}${buscar(dados.unidade_medida_basica, unidade.fk_unidade_medida_basica).nome}`)} (${siglaUnidade(id)})`;
}

const unidadeAlimento = alimentoId => siglaUnidade(buscar(dados.alimento, alimentoId).fk_unidade_medida);
const nomeProduto = produto => `${buscar(dados.alimento, produto.fk_alimento).nome} · ${produto.descricao}`;
const embalagem = produto => produto.embalagem || "un";
const descricaoLanche = lanche => lanche.nome || lanche.descricao || buscar(dados.cardapio, lanche.fk_cardapio).nome;
const fornecedorDoEmpenho = empenho => buscar(dados.fornecedor, empenho.fk_fornecedor);
const produtoDaEntrega = entrega => buscar(dados.produto, buscar(dados.item_empenho, entrega.fk_item_empenho).fk_produto);

const itensVigentes = produtoId => dados.item_empenho.filter(item => item.fk_produto === produtoId && vigente(buscar(dados.empenho, item.fk_empenho)));
const aReceberItem = itemId => doRegistro("agenda_entrega_empenho", "fk_item_empenho", itemId).filter(pendente)
    .reduce((total, entrega) => total + entrega.quant_solicitada - entrega.quant_entregue, 0);
const aReceber = produtoId => doRegistro("item_empenho", "fk_produto", produtoId).reduce((total, item) => total + aReceberItem(item.id), 0);
const saldoItemEmpenho = item => precisao(item.quant_empenhada - item.quant_entregue - aReceberItem(item.id));
const saldoEmpenho = produtoId => precisao(itensVigentes(produtoId).reduce((total, item) => total + saldoItemEmpenho(item), 0));
const lancheBloqueado = lancheId => dados.lanche_agendado.some(a => a.fk_lanche === lancheId && a.situacao === "entregue");

function estoqueLocalAlimento(alimentoId) {
    const prods = doRegistro("produto", "fk_alimento", alimentoId);
    return precisao(prods.reduce((soma, p) => soma + (p.estoque_local * p.quant_unit_base), 0));
}

function estoqueProvisionadoAlimento(alimentoId) {
    const prods = doRegistro("produto", "fk_alimento", alimentoId);
    return precisao(prods.reduce((soma, p) => soma + (p.estoque_provisionado * p.quant_unit_base), 0));
}

// Quantidade consumida com a unidade de consumo gravada no item do lanche ("1 unidade", "0,2 L", "4 biscoitos").
function consumo(item) {
    const produto = buscar(dados.produto, item.fk_produto);
    let unidade = item.unidade_consumo || unidadeConsumo(item.forma_consumo, produto);
    if (item.forma_consumo === "inteiro") unidade = item.quant_consumida > 1 ? "unidades" : "unidade";
    if (item.forma_consumo === "subitens") {
        unidade = produto.nome_subitem || (item.quant_consumida === 1 ? "subitem" : "subitens");
    }
    return `${num(item.quant_consumida)} ${unidade}`;
}

const porLanche = item => banco.consumoPorLanche(item, buscar(dados.produto, item.fk_produto));

// Unidade de consumo conforme a forma de consumo (a mesma regra que o banco usa ao gravar).
function unidadeConsumo(referencia, produto) {
    if (!produto) return "";
    if (referencia === "inteiro") return "unidade";
    if (referencia === "unidade_base") return unidadeAlimento(produto.fk_alimento);
    return produto.nome_subitem || "subitens";
}

function turnoTag(turno) {
    return `<span class="turno-tag ${turno}">${icone(turno === "manha" ? "wb_sunny" : "wb_twilight")}${turnos[turno]}</span>`;
}

function barraEstoque(produto) {
    const pct = produto.estoque_local > 0 ? 100 : 0;
    const nivel = produto.estoque_local <= 0 ? "critico" : "ok";
    return `<div class="barra" title="Estoque local: ${num(produto.estoque_local)}"><i class="${nivel}" style="width:${pct}%"></i></div>`;
}

function barraPercentual(pct) {
    return `<div class="percentual"><div class="barra"><i class="ok" style="width:${Math.min(pct, 100)}%"></i></div><span>${pct}%</span></div>`;
}

const percentual = (parte, total) => total ? Math.round(parte / total * 100) : 0;

function consumoProdutos(inicio, fim) {
    const totais = new Map();
    dados.lanche_agendado.filter(a => a.situacao === "agendado" && a.data >= inicio && a.data <= fim).forEach(a => {
        itensLanche(a.fk_lanche).forEach(item => totais.set(item.fk_produto, (totais.get(item.fk_produto) || 0) + porLanche(item) * a.quantidade));
    });
    return totais;
}

function previsao(inicio) {
    const antes = inicio > hoje ? consumoProdutos(hoje, somarDias(inicio, -1)) : new Map();
    return [...consumoProdutos(inicio, somarDias(inicio, 4))]
        .map(([produtoId, total]) => {
            const produto = buscar(dados.produto, produtoId);
            return {
                produto,
                necessario: arredondarCima(total),
                previsto: precisao(produto.estoque_local + aReceber(produtoId) - arredondarCima(antes.get(produtoId) || 0))
            };
        })
        .sort((a, b) => nomeProduto(a.produto).localeCompare(nomeProduto(b.produto)));
}

function situacaoNecessidade({ produto, necessario, previsto }) {
    if (necessario <= previsto) return ["Estoque suficiente", "verde", ""];
    const saldo = saldoEmpenho(produto.id);
    if (necessario <= previsto + saldo) return ["Solicitar entrega", "laranja", `<button class="btn-mini" data-novo="agenda_entrega_empenho" data-produto="${produto.id}" data-quantidade="${arredondarCima(necessario - previsto)}">Solicitar entrega</button>`];
    return ["Sem empenho", "vermelho", `<button class="btn-mini" data-novo="empenho" data-produto="${produto.id}" data-quantidade="${arredondarCima(necessario - previsto - saldo)}">Cadastrar empenho</button>`];
}

// ---------------------------------------------------------------------------------------------
// Navegação

function navegar() {
    const id = location.hash.slice(1) in paginas ? location.hash.slice(1) : "inicio";
    document.querySelectorAll(".pagina").forEach(pagina => pagina.hidden = pagina.dataset.pagina !== id);
    document.querySelectorAll(".menu a").forEach(link => link.classList.toggle("ativo", link.getAttribute("href") === `#${id}`));
    el("trilha-grupo").textContent = paginas[id][0];
    el("trilha-pagina").textContent = paginas[id][1];
    document.body.classList.remove("menu-aberto");
    window.scrollTo(0, 0);
    if (id === "recebimento" && entregaFocoId) {
        const card = document.querySelector(`[data-entrega="${entregaFocoId}"]`);
        if (card) {
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            card.style.outline = "2px solid var(--verde-ifrs, #2f855a)";
            setTimeout(() => { card.style.outline = ""; }, 2500);
        }
        entregaFocoId = null;
    }
}

function alternarMenu() {
    document.body.classList.toggle("menu-aberto");
}

function irParaRecebimento(entregaId) {
    entregaFocoId = entregaId;
    location.hash = "#recebimento";
}

// ---------------------------------------------------------------------------------------------
// Telas

function renderInicio() {
    const doDia = dados.lanche_agendado.filter(a => a.data === hoje).sort(porTurno);
    const pendentes = dados.agenda_entrega_empenho.filter(pendente).sort((a, b) => a.data_prevista_entrega.localeCompare(b.data_prevista_entrega));
    const vigentes = dados.empenho.filter(vigente);
    const comEmpenho = dados.produto.filter(p => p.estoque_local > 0);
    const turnosDoDia = new Set(doDia.map(a => a.turno)).size;
    const fornecedores = new Set(vigentes.map(e => e.fk_fornecedor)).size;

    el("inicio-data").textContent = new Date(`${hoje}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    el("stat-lanches").textContent = doDia.reduce((total, a) => total + a.quantidade, 0);
    el("stat-lanches-info").textContent = doDia.length
        ? `${doDia.length} ${doDia.length === 1 ? "opção" : "opções"} em ${turnosDoDia} ${turnosDoDia === 1 ? "turno" : "turnos"}`
        : "nenhum lanche agendado";
    el("stat-entregas").textContent = pendentes.length;
    el("stat-abaixo").textContent = previsao(somarDias(segundaDaSemana(hoje), 7)).filter(n => n.necessario > n.previsto).length;
    el("stat-empenhos").textContent = vigentes.length;
    el("stat-empenhos-info").textContent = `${fornecedores} ${fornecedores === 1 ? "fornecedor" : "fornecedores"}`;

    el("inicio-lanches").innerHTML = doDia.length ? doDia.map(a => {
        const lanche = buscar(dados.lanche, a.fk_lanche);
        return `
            <li class="linha-lista">
                ${turnoTag(a.turno)}
                <div class="linha-info"><strong>Lanche ${lanche.id}</strong><span>${esc(descricaoLanche(lanche))}</span></div>
                <div class="linha-qtd"><strong>${a.quantidade}</strong><span>previstos</span></div>
                ${a.situacao === "entregue" ? badge("Entregue", "verde") : `<a class="btn-mini" href="#entrega-lanche" onclick="selecionarAgendado(${a.id})">Registrar</a>`}
            </li>`;
    }).join("") : `<li>${vazio("event_busy", "Nenhum lanche agendado para hoje.")}</li>`;

    el("inicio-entregas").innerHTML = pendentes.length ? pendentes.slice(0, 5).map(e => {
        const produto = produtoDaEntrega(e);
        const [texto, cor] = estadosEntrega[e.estado];
        return `
            <li class="linha-lista">
                <div class="data-bloco${e.data_prevista_entrega === hoje ? " hoje" : ""}"><strong>${e.data_prevista_entrega.slice(8)}</strong><span>${mesCurto(e.data_prevista_entrega)}</span></div>
                <div class="linha-info"><strong>${esc(nomeProduto(produto))}</strong><span>${esc(fornecedorDoEmpenho(buscar(dados.empenho, e.fk_empenho)).nome)}</span></div>
                <div class="linha-qtd"><strong>${num(e.quant_solicitada - e.quant_entregue)}</strong><span>${esc(embalagem(produto))}</span></div>
                ${badge(texto, cor)}
            </li>`;
    }).join("") : `<li>${vazio("local_shipping", "Nenhuma entrega pendente.")}</li>`;

    el("inicio-estoque").innerHTML = comEmpenho.length ? comEmpenho.map(p => `
        <div class="estoque-item">
            <div class="estoque-nome"><strong>${esc(buscar(dados.alimento, p.fk_alimento).nome)}</strong><span>${esc(p.descricao)}</span></div>
            ${barraEstoque(p)}
            <div class="estoque-valores"><span>${num(p.estoque_local)} ${esc(embalagem(p))}</span><span>estoque local</span></div>
        </div>`).join("") : vazio("inventory_2", "Nenhum produto em estoque.");
}

function mudarSemana(passo) {
    semanaAtual = passo === 0 ? segundaDaSemana(hoje) : somarDias(semanaAtual, passo * 7);
    renderSemana();
}

function verEntrega(id) {
    location.hash = "#entrega-lanche";
    selecionarAgendado(id);
}

function statusProdutosAgendamento(agendado) {
    const itens = itensLanche(agendado.fk_lanche);
    if (!itens.length) {
        return { semProdutos: true, motivo: "Sem produtos cadastrados no lanche" };
    }
    const faltando = itens.some(item => {
        const prod = buscar(dados.produto, item.fk_produto);
        return !prod || prod.estoque_local <= 0;
    });
    if (faltando) {
        return { semProdutos: true, motivo: "Sem produtos disponíveis em estoque" };
    }
    return { semProdutos: false, motivo: "" };
}

function renderSemana() {
    const dias = [0, 1, 2, 3, 4].map(n => somarDias(semanaAtual, n));
    el("semana-titulo").textContent = `${diaMes(dias[0])} a ${formatarData(dias[4])}`;
    
    let linhasHtml = "";
    dias.forEach((dia, i) => {
        const agendamentosDia = dados.lanche_agendado.filter(a => a.data === dia).sort(porTurno);
        
        if (agendamentosDia.length === 0) {
            linhasHtml += `
                <tr class="linha-dia-cabecalho"><td colspan="5"><strong>${nomesDias[i]} (${diaMes(dia)})</strong> ${dia === hoje ? '<em>(Hoje)</em>' : ''}</td></tr>
                <tr><td colspan="5" class="vazio-tabela">Nenhum lanche agendado para este dia. <button class="btn-mini" data-novo="lanche_agendado" data-data="${dia}">Adicionar</button></td></tr>`;
        } else {
            agendamentosDia.forEach((a, idx) => {
                const lanche = buscar(dados.lanche, a.fk_lanche);
                const [textoStatus, corStatus] = a.situacao === "entregue" ? ["Entregue", "verde"] : ["Agendado", "azul"];
                const alertaProdutos = a.situacao !== "entregue" ? statusProdutosAgendamento(a) : { semProdutos: false };
                
                linhasHtml += `
                    <tr class="${alertaProdutos.semProdutos ? "linha-sem-produto" : ""}" style="${alertaProdutos.semProdutos ? "border-left: 4px solid #dc2626; background-color: #fef2f2;" : ""}">
                        ${idx === 0 ? `<td rowspan="${agendamentosDia.length}"><strong>${nomesDias[i]}</strong><br><small>${diaMes(dia)}</small></td>` : ''}
                        <td>
                            ${turnoTag(a.turno)} <strong>Lanche ${lanche.id}</strong>: ${esc(descricaoLanche(lanche))}
                            ${alertaProdutos.semProdutos ? `<div style="margin-top:4px;">${badge(alertaProdutos.motivo, "vermelho")}</div>` : ""}
                        </td>
                        <td class="num"><strong>${a.quantidade}</strong></td>
                        <td>${badge(textoStatus, corStatus)}</td>
                        <td class="acoes">
                            ${a.situacao !== "entregue" ? `<button class="btn-icone" data-editar="lanche_agendado" data-id="${a.id}" title="Editar"><span class="icone" aria-hidden="true">edit</span></button>` : `<button class="btn-icone" onclick="verEntrega(${a.id})" title="Ver entrega"><span class="icone" aria-hidden="true">visibility</span></button>`}
                        </td>
                    </tr>`;
            });
        }
    });

    el("tabela-agendamento-planilha").innerHTML = linhasHtml;
    renderNecessidade();
}

function renderNecessidade() {
    const lista = previsao(semanaAtual);
    el("previsao-periodo").textContent = `${formatarData(semanaAtual)} a ${formatarData(somarDias(semanaAtual, 4))}`;
    el("tabela-necessidade").innerHTML = lista.length ? lista.map(n => {
        const { produto } = n;
        const [texto, cor, acao] = situacaoNecessidade(n);
        return `
            <tr>
                <td><strong>${esc(nomeProduto(produto))}</strong></td>
                <td class="num">${num(n.necessario)} ${esc(embalagem(produto))}</td>
                <td class="num">${num(n.previsto)} ${esc(embalagem(produto))}<small>local ${num(produto.estoque_local)} · a receber ${num(aReceber(produto.id))}</small></td>
                <td class="num">${num(saldoEmpenho(produto.id))} ${esc(embalagem(produto))}</td>
                <td>${badge(texto, cor)}</td>
                <td class="acoes">${acao}</td>
            </tr>`;
    }).join("") : linhaVazia(6, "event_note", "Nenhum lanche a entregar agendado nesta semana.");
}

function selecionarAgendado(id) {
    agendadoSelecionado = id;
    el("entrega-data").value = buscar(dados.lanche_agendado, id).data;
    renderEntregaLista();
}

function renderEntregaLista() {
    const doDia = dados.lanche_agendado.filter(a => a.data === el("entrega-data").value).sort(porTurno);
    if (!doDia.some(a => a.id === agendadoSelecionado)) agendadoSelecionado = doDia.length ? doDia[0].id : null;

    el("entrega-lista").innerHTML = doDia.length ? doDia.map(a => `
        <button class="opcao-agendado${a.id === agendadoSelecionado ? " selecionado" : ""}" onclick="selecionarAgendado(${a.id})">
            ${turnoTag(a.turno)}
            <span class="opcao-info"><strong>Lanche ${a.fk_lanche}</strong><small>${a.quantidade} previstos</small></span>
            ${a.situacao === "entregue" ? `<span class="icone status-ok" role="img" aria-label="Entregue">task_alt</span>` : `<span class="icone status-pendente" role="img" aria-label="Pendente">schedule</span>`}
        </button>`).join("") : vazio("event_busy", "Nenhum lanche agendado nesta data.");

    renderEntregaDetalhe();
}

function renderEntregaDetalhe() {
    const agendado = buscar(dados.lanche_agendado, agendadoSelecionado);
    if (!agendado) {
        el("entrega-detalhe").innerHTML = vazio("lunch_dining", "Selecione um lanche agendado na lista ao lado para registrar a entrega.");
        return;
    }

    const lanche = buscar(dados.lanche, agendado.fk_lanche);
    const cardapio = buscar(dados.cardapio, lanche.fk_cardapio);
    const entregue = agendado.situacao === "entregue";
    const futuro = !entregue && agendado.data > hoje;
    const itensDoLanche = itensLanche(lanche.id);
    const semItens = !entregue && itensDoLanche.length === 0;
    const bloqueio = entregue || futuro || semItens ? " disabled" : "";
    const registros = doRegistro("item_lanche_agendado", "fk_lanche_agendado", agendado.id);

    let rodape = `<div class="aviso aviso-info">${icone("info")}Ao confirmar, os produtos entregues saem do estoque local. A sobra volta ao estoque local; se ela não puder ser reaproveitada, desmarque "volta ao estoque" e ela será registrada como perda.</div>
                  <button class="btn btn-primario">${icone("check")}Confirmar entrega da opção</button>`;
    if (entregue) rodape = `<div class="aviso aviso-bloqueio">${icone("lock")}Entrega já registrada para este lanche.</div>`;
    else if (futuro) rodape = `<div class="aviso aviso-info">${icone("event")}Este lanche está agendado para data futura (${formatarData(agendado.data)}).</div>`;
    else if (semItens) rodape = `<div class="aviso aviso-erro">${icone("warning")}Este lanche ainda não possui produtos vinculados. Edite o lanche para vincular os produtos antes de registrar a entrega.</div>`;

    el("entrega-detalhe").innerHTML = `
        <form id="form-entrega">
            <div class="detalhe-topo">
                <div class="detalhe-icone">${icone("lunch_dining")}</div>
                <div class="detalhe-titulo">
                    <span class="sobretitulo">${formatarData(agendado.data)} · ${turnos[agendado.turno]}</span>
                    <h3>Opção: Lanche ${lanche.id} · ${esc(descricaoLanche(lanche))}</h3>
                    <p>Cardápio ${cardapio.id}: ${esc(cardapio.nome)}</p>
                </div>
                ${entregue ? badge("Entregue", "verde") : badge("Agendado", "azul")}
            </div>
            
            <div class="resumo-entrega" data-linha>
                <div class="resumo-box"><span>Previstos para esta opção</span><strong>${agendado.quantidade}</strong></div>
                <label class="resumo-box"><span>Quantidade efetivamente entregue</span><input class="input-grande" type="number" name="quant_entregue" min="0" max="${agendado.quantidade}" step="1" required value="${entregue ? agendado.quant_entregue : agendado.quantidade}" data-planejado="${agendado.quantidade}" data-unidade="" oninput="atualizarLanchesEntregues(this)"${bloqueio}></label>
                <div class="resumo-box"><span>Sobra</span><strong class="sobra"></strong></div>
            </div>
            <div class="tabela-wrap tabela-borda">
                <table class="tabela">
                    <thead><tr><th>Item do lanche</th><th>Forma de consumo</th><th class="num">Planejado</th><th class="num">Entregue</th><th class="num">Sobra</th><th>Sobra volta ao estoque</th><th>Observação</th></tr></thead>
                    <tbody>${itensDoLanche.length ? itensDoLanche.map(item => {
                        const produto = buscar(dados.produto, item.fk_produto);
                        const planejado = precisao(porLanche(item) * agendado.quantidade);
                        const registro = registros.find(r => r.fk_item_lanche === item.id) || { quant_entregue: planejado, observacoes: "" };
                        const ref = referencias[item.forma_consumo];
                        return `
                            <tr data-linha data-item-lanche="${item.id}">
                                <td><strong>${esc(nomeProduto(produto))}</strong><small>${esc(consumo(item))} por lanche</small></td>
                                <td><span class="ref ${ref.classe}">${ref.nome}</span></td>
                                <td class="num">${num(planejado)} ${esc(embalagem(produto))}</td>
                                <td class="num"><input class="input-tabela" type="number" data-campo="quant_entregue" min="0" max="${planejado}" step="any" required value="${registro.quant_entregue}" data-planejado="${planejado}" data-por-lanche="${porLanche(item)}" data-unidade="${esc(embalagem(produto))}" oninput="this.dataset.editado = 1; atualizarSobra(this)"${bloqueio}></td>
                                <td class="num sobra"></td>
                                <td>${entregue ? "—" : `<label class="check-sobra"><input type="checkbox" data-sobra-volta checked${bloqueio}> Sim</label>`}</td>
                                <td><input class="input-tabela input-texto" type="text" data-campo="observacoes" maxlength="350" placeholder="Opcional" value="${esc(registro.observacoes)}"${bloqueio}></td>
                            </tr>`;
                    }).join("") : `<tr><td colspan="7" class="vazio-tabela">Nenhum produto vinculado a este lanche.</td></tr>`}</tbody>
                </table>
            </div>
            <label class="campo"><span>Observações</span><textarea name="observacoes" rows="2" maxlength="350" placeholder="Opcional"${bloqueio}>${esc(agendado.observacoes)}</textarea></label>
            <div class="detalhe-rodape">${rodape}</div>
        </form>`;

    el("entrega-detalhe").querySelectorAll("[data-planejado]").forEach(atualizarSobra);
}

function atualizarLanchesEntregues(input) {
    atualizarSobra(input);
    const lanches = Math.max(0, Number(input.value) || 0);
    input.form.querySelectorAll("[data-item-lanche] [data-campo=quant_entregue]").forEach(campo => {
        if (campo.dataset.editado) return;
        campo.value = precisao(Math.min(campo.dataset.porLanche * lanches, campo.dataset.planejado));
        atualizarSobra(campo);
    });
}

function atualizarSobra(input) {
    const sobra = precisao(input.dataset.planejado - input.value) || 0;
    const alvo = input.closest("[data-linha]").querySelector(".sobra");
    alvo.textContent = `${num(sobra)} ${input.dataset.unidade}`.trim();
    alvo.classList.toggle("positiva", sobra > 0);
    alvo.classList.toggle("negativa", sobra < 0);
}

function renderHistorico() {
    const entregues = dados.lanche_agendado
        .filter(a => a.situacao === "entregue")
        .sort((a, b) => b.data.localeCompare(a.data) || b.turno.localeCompare(a.turno));

    el("tabela-historico").innerHTML = entregues.length ? entregues.map(a => {
        const lanche = buscar(dados.lanche, a.fk_lanche);
        const sobra = a.quantidade - a.quant_entregue;
        return `
            <tr>
                <td>${formatarData(a.data)}</td>
                <td>${turnoTag(a.turno)}</td>
                <td><strong>Lanche ${lanche.id}</strong><small>${esc(descricaoLanche(lanche))}</small></td>
                <td class="num">${a.quantidade}</td>
                <td class="num">${a.quant_entregue}</td>
                <td class="num"><span class="sobra${sobra > 0 ? " positiva" : sobra < 0 ? " negativa" : ""}">${sobra}</span></td>
                <td>${barraPercentual(percentual(a.quant_entregue, a.quantidade))}</td>
            </tr>`;
    }).join("") : linhaVazia(7, "history", "Nenhuma entrega de lanche registrada ainda.");
}

function renderCardapios() {
    el("lista-cardapios").innerHTML = dados.cardapio.length ? dados.cardapio.map(c => {
        const vinculados = doRegistro("lanche", "fk_cardapio", c.id).length;
        return `
            <tr data-filtro="">
                <td><strong>C${c.id}</strong></td>
                <td><strong>${esc(c.nome)}</strong></td>
                <td>${esc(c.descricao || "—")}</td>
                <td class="num">${vinculados}</td>
                <td class="acoes">${botoesLinha("cardapio", c.id)}</td>
            </tr>`;
    }).join("") : linhaVazia(5, "menu_book", "Nenhum cardápio cadastrado.");
}

function renderLanches() {
    el("lista-lanches").innerHTML = dados.lanche.length ? dados.lanche.map(l => {
        const cardapio = buscar(dados.cardapio, l.fk_cardapio);
        const bloqueado = lancheBloqueado(l.id);
        const itens = itensLanche(l.id);
        const itensDesc = itens.length ? itens.map(item => {
            const ref = referencias[item.forma_consumo];
            return `<div><strong>${esc(consumo(item))}</strong> de ${esc(nomeProduto(buscar(dados.produto, item.fk_produto)))} <span class="ref ${ref.classe}">${ref.nome}</span></div>`;
        }).join("") : `<div>${badge("Sem produtos vinculados", "vermelho")}</div>`;
        const detalheLanche = [l.descricao, `Cardápio ${cardapio.id} · ${cardapio.nome}`].filter(Boolean).join(" · ");
        // Restrição 2: lanche entregue não é alterado; cria-se uma nova versão e ele é finalizado como sobra.
        const situacao = l.situacao === "sobra" ? badge("Finalizado (sobra)", "cinza")
            : bloqueado ? badge("Já entregue (bloqueado)", "vermelho") : badge("Disponível", "azul");
        const acoes = l.situacao === "sobra" ? ""
            : bloqueado ? `<button class="btn-mini" data-novo="lanche" data-substitui="${l.id}" title="Cria um novo lanche a partir deste e finaliza este como sobra">${icone("content_copy")}Nova versão</button>`
            : botoesLinha("lanche", l.id);
        return `
            <tr data-filtro="">
                <td><strong>L${l.id}</strong></td>
                <td><strong>${esc(l.nome || descricaoLanche(l))}</strong><small>${esc(detalheLanche)}</small></td>
                <td>${itensDesc}</td>
                <td>${situacao}</td>
                <td class="acoes">${acoes}</td>
            </tr>`;
    }).join("") : linhaVazia(5, "lunch_dining", "Nenhum lanche cadastrado.");
}

function renderAlimentos() {
    el("tabela-alimentos").innerHTML = dados.alimento.length ? dados.alimento.map(a => {
        const bebida = a.natureza === "bebida";
        const sigla = siglaUnidade(a.fk_unidade_medida);
        const local = estoqueLocalAlimento(a.id);
        const prov = estoqueProvisionadoAlimento(a.id);
        return `
            <tr data-filtro="${a.natureza}">
                <td><div class="celula-nome"><span class="avatar-item ${a.natureza}">${icone(bebida ? "local_drink" : "restaurant")}</span><div><strong>${esc(a.nome)}</strong><small>${esc(a.descricao)}</small></div></div></td>
                <td>${badge(maiuscula(a.natureza), bebida ? "azul" : "laranja")}</td>
                <td>${esc(maiuscula(a.grupo))}</td>
                <td><span class="unidade">${sigla}</span></td>
                <td class="num"><strong>${num(local)} ${sigla}</strong></td>
                <td class="num">${num(prov)} ${sigla}</td>
                <td class="acoes">${botoesLinha("alimento", a.id)}</td>
            </tr>`;
    }).join("") : linhaVazia(7, "nutrition", "Nenhum alimento cadastrado.");
}

function renderProdutos() {
    el("tabela-produtos").innerHTML = dados.produto.length ? dados.produto.map(p => {
        const alimento = buscar(dados.alimento, p.fk_alimento);
        const bebida = alimento.natureza === "bebida";
        const subitens = p.quant_subitens === 0 ? " · não particionável" : p.quant_subitens > 1 ? ` (${p.quant_subitens} ${esc(p.nome_subitem || "subitens")})` : "";
        return `
            <tr data-filtro="${alimento.natureza}">
                <td><div class="celula-nome"><span class="avatar-item ${alimento.natureza}">${icone(bebida ? "local_drink" : "inventory_2")}</span><div><strong>${esc(alimento.nome)}</strong><small>${esc(p.descricao)} · cód. ${p.id}</small></div></div></td>
                <td>${num(p.quant_unit_base)} ${siglaUnidade(alimento.fk_unidade_medida)}<small>por ${esc(embalagem(p))}${subitens}</small></td>
                <td class="col-estoque">${barraEstoque(p)}<small>Local: <strong>${num(p.estoque_local)} ${esc(embalagem(p))}</strong> · Provisionado: <strong>${num(p.estoque_provisionado)} ${esc(embalagem(p))}</strong></small></td>
                <td class="acoes"><button class="btn-icone" data-novo="perda" data-produto="${p.id}" title="Registrar perda" aria-label="Registrar perda">${icone("remove_shopping_cart")}</button>${botoesLinha("produto", p.id)}</td>
            </tr>`;
    }).join("") : linhaVazia(4, "inventory_2", "Nenhum produto cadastrado.");
}

function renderPerdas() {
    const perdas = [...dados.perda].sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
    el("tabela-perdas").innerHTML = perdas.length ? perdas.map(p => {
        const produto = buscar(dados.produto, p.fk_produto);
        return `
            <tr>
                <td>${formatarData(p.data)}</td>
                <td><strong>${esc(nomeProduto(produto))}</strong></td>
                <td class="num">${num(p.quantidade)} ${esc(embalagem(produto))}</td>
                <td>${esc(p.motivo)}</td>
                <td class="acoes"><button class="btn-icone" data-excluir="perda" data-id="${p.id}" title="Excluir (devolve ao estoque local)" aria-label="Excluir">${icone("delete")}</button></td>
            </tr>`;
    }).join("") : linhaVazia(5, "remove_shopping_cart", "Nenhuma perda registrada.");
}

function renderFornecedores() {
    el("tabela-fornecedores").innerHTML = dados.fornecedor.length ? dados.fornecedor.map(f => {
        const vigentes = doRegistro("empenho", "fk_fornecedor", f.id).filter(vigente).length;
        const iniciais = f.nome.split(" ").filter(parte => parte.length > 2).slice(0, 2).map(parte => parte[0]).join("") || f.nome[0];
        return `
            <tr>
                <td><div class="celula-nome"><span class="avatar-item">${esc(iniciais.toUpperCase())}</span><div><strong>${esc(f.nome)}</strong><small>${esc(f.email)}</small></div></div></td>
                <td class="mono">${esc(f.cnpj)}</td>
                <td>${esc(f.telefone)}</td>
                <td>${vigentes ? badge(`${vigentes} vigente${vigentes > 1 ? "s" : ""}`, "verde") : badge("Nenhum", "cinza")}</td>
                <td class="acoes">${botoesLinha("fornecedor", f.id)}</td>
            </tr>`;
    }).join("") : linhaVazia(5, "storefront", "Nenhum fornecedor cadastrado.");
}

function renderEmpenhos() {
    const empenhos = [...dados.empenho].sort((a, b) => b.data_inicial.localeCompare(a.data_inicial) || b.id - a.id);
    el("lista-empenhos").innerHTML = empenhos.length ? empenhos.map(e => {
        const itens = itensEmpenho(e.id);
        return `
            <article class="card empenho" data-filtro="${vigente(e) ? "vigente" : "encerrado"}">
                <div class="empenho-topo">
                    <div class="empenho-icone">${icone("receipt_long")}</div>
                    <div class="empenho-titulo"><strong>${esc(e.sigla)}</strong><span>${esc(fornecedorDoEmpenho(e).nome)}</span></div>
                    <div class="empenho-meta">
                        <span>${icone("date_range")}${formatarData(e.data_inicial)} a ${formatarData(e.data_final)}</span>
                        <span>${icone("inventory_2")}${itens.length} ${itens.length === 1 ? "item" : "itens"}</span>
                    </div>
                    ${e.data_inicial > hoje ? badge("A iniciar", "azul") : vigente(e) ? badge("Vigente", "verde") : badge("Encerrado", "cinza")}
                    <button class="btn-icone" data-editar="empenho" data-id="${e.id}" title="Editar" aria-label="Editar empenho">${icone("edit")}</button>
                </div>
                <div class="tabela-wrap tabela-embutida">
                    <table class="tabela">
                        <thead><tr><th>Produto</th><th class="num">Empenhado</th><th class="num">Entregue</th><th class="num">A entregar</th><th>Execução</th></tr></thead>
                        <tbody>${itens.map(item => {
                            const produto = buscar(dados.produto, item.fk_produto);
                            const solicitado = precisao(aReceberItem(item.id));
                            return `
                                <tr>
                                    <td><strong>${esc(nomeProduto(produto))}</strong></td>
                                    <td class="num">${num(item.quant_empenhada)} ${esc(embalagem(produto))}</td>
                                    <td class="num">${num(item.quant_entregue)} ${esc(embalagem(produto))}</td>
                                    <td class="num">${num(item.quant_empenhada - item.quant_entregue)} ${esc(embalagem(produto))}${solicitado ? `<small>${num(solicitado)} já solicitado</small>` : ""}</td>
                                    <td>${barraPercentual(percentual(item.quant_entregue, item.quant_empenhada))}</td>
                                </tr>`;
                        }).join("")}</tbody>
                    </table>
                </div>
            </article>`;
    }).join("") : vazio("receipt_long", "Nenhum empenho registrado.", "card");
}

function renderAgendaEmpenho() {
    const entregas = [...dados.agenda_entrega_empenho].sort((a, b) => b.data_prevista_entrega.localeCompare(a.data_prevista_entrega) || b.id - a.id);
    el("tabela-agenda-empenho").innerHTML = entregas.length ? entregas.map(e => {
        const empenho = buscar(dados.empenho, e.fk_empenho);
        const produto = produtoDaEntrega(e);
        const [texto, cor] = estadosEntrega[e.estado];
        return `
            <tr data-filtro="${e.estado}">
                <td><strong>${esc(empenho.sigla)}</strong><small>${esc(fornecedorDoEmpenho(empenho).nome)}</small></td>
                <td>${esc(nomeProduto(produto))}</td>
                <td>${formatarData(e.data_solicitacao)}</td>
                <td>${formatarData(e.data_prevista_entrega)}</td>
                <td class="num">${num(e.quant_solicitada)} ${esc(embalagem(produto))}</td>
                <td class="num">${e.quant_entregue ? `${num(e.quant_entregue)} ${esc(embalagem(produto))}` : "—"}</td>
                <td>${badge(texto, cor)}</td>
                <td class="acoes">${pendente(e) ? `<button type="button" class="btn-mini" onclick="irParaRecebimento(${e.id})">Receber</button>` : ""}</td>
            </tr>`;
    }).join("") : linhaVazia(8, "local_shipping", "Nenhuma entrega solicitada aos fornecedores.");
}

function renderRecebimento() {
    const pendentes = dados.agenda_entrega_empenho.filter(pendente).sort((a, b) => a.data_prevista_entrega.localeCompare(b.data_prevista_entrega));
    el("lista-recebimento").innerHTML = pendentes.length ? pendentes.map(e => {
        const empenho = buscar(dados.empenho, e.fk_empenho);
        const produto = produtoDaEntrega(e);
        const [texto, cor] = estadosEntrega[e.estado];
        const saldo = precisao(e.quant_solicitada - e.quant_entregue);
        return `
            <article class="card recebimento" data-entrega="${e.id}">
                <div class="recebimento-topo">
                    <div class="data-bloco${e.data_prevista_entrega === hoje ? " hoje" : ""}"><strong>${e.data_prevista_entrega.slice(8)}</strong><span>${mesCurto(e.data_prevista_entrega)}</span></div>
                    <div class="linha-info"><strong>${esc(nomeProduto(produto))}</strong><span>${esc(fornecedorDoEmpenho(empenho).nome)} · ${esc(empenho.sigla)}</span></div>
                    ${badge(texto, cor)}
                </div>
                <div class="recebimento-numeros">
                    <div><span>Solicitado</span><strong>${num(e.quant_solicitada)} ${esc(embalagem(produto))}</strong></div>
                    <div><span>Já recebido</span><strong>${num(e.quant_entregue)} ${esc(embalagem(produto))}</strong></div>
                    <div><span>A receber</span><strong>${num(saldo)} ${esc(embalagem(produto))}</strong></div>
                </div>
                <div class="campos">
                    <label class="campo"><span>Data do recebimento</span><input type="date" data-campo="data_entregue" value="${hoje}" max="${hoje}" required></label>
                    <label class="campo"><span>Quantidade recebida</span><input type="number" data-campo="quant_recebida" min="0.001" max="${saldo}" step="any" value="${saldo}" required></label>
                    <label class="campo campo-largo"><span>Observação</span><input type="text" data-campo="observacao" maxlength="350" placeholder="Opcional" value="${esc(e.observacao)}"></label>
                </div>
                <div class="recebimento-acoes">
                    <button class="btn btn-fantasma" data-finalizar="${e.id}">${icone("block")}Finalizar sem completar</button>
                    <button class="btn btn-primario" data-receber="${e.id}">${icone("inventory")}Registrar recebimento</button>
                </div>
            </article>`;
    }).join("") : vazio("move_to_inbox", "Nenhuma entrega aguardando recebimento.", "card");

    const recebidos = dados.agenda_entrega_empenho.filter(e => e.data_entregue).sort((a, b) => b.data_entregue.localeCompare(a.data_entregue) || b.id - a.id);
    el("tabela-recebidos").innerHTML = recebidos.length ? recebidos.map(e => {
        const empenho = buscar(dados.empenho, e.fk_empenho);
        const produto = produtoDaEntrega(e);
        const [texto, cor] = estadosEntrega[e.estado];
        return `
            <tr>
                <td>${formatarData(e.data_entregue)}</td>
                <td><strong>${esc(nomeProduto(produto))}</strong><small>${esc(e.observacao)}</small></td>
                <td>${esc(empenho.sigla)}<small>${esc(fornecedorDoEmpenho(empenho).nome)}</small></td>
                <td class="num">${num(e.quant_solicitada)} ${esc(embalagem(produto))}</td>
                <td class="num">${num(e.quant_entregue)} ${esc(embalagem(produto))}</td>
                <td>${badge(texto, cor)}</td>
            </tr>`;
    }).join("") : linhaVazia(6, "inventory", "Nenhum recebimento registrado.");
}

function renderizarTudo() {
    renderInicio();
    renderSemana();
    renderEntregaLista();
    renderHistorico();
    renderCardapios();
    renderLanches();
    renderAlimentos();
    renderProdutos();
    renderPerdas();
    renderFornecedores();
    renderEmpenhos();
    renderAgendaEmpenho();
    renderRecebimento();
    document.querySelectorAll("[data-filtragem]").forEach(filtrar);
}

async function atualizar() {
    Object.assign(dados, await banco.listarTudo());
    renderizarTudo();
}

// ---------------------------------------------------------------------------------------------
// Formulários de cadastro

const opcoesSelect = {
    unidades: () => dados.unidade_medida.map(u => [u.id, nomeUnidade(u.id)]),
    alimentos: () => ordenado(dados.alimento, a => a.nome).map(a => [a.id, `${a.nome} (${unidadeAlimento(a.id)})`]),
    produtos: () => ordenado(dados.produto, nomeProduto).map(p => [p.id, nomeProduto(p)]),
    fornecedores: () => ordenado(dados.fornecedor, f => f.nome).map(f => [f.id, f.nome]),
    empenhos: () => dados.empenho.filter(vigente).map(e => [e.id, `${e.sigla} · ${fornecedorDoEmpenho(e).nome}`]),
    cardapios: () => dados.cardapio.map(c => [c.id, `Cardápio ${c.id} · ${c.nome}`]),
    lanches: () => dados.lanche.filter(l => l.situacao !== "sobra").map(l => [l.id, `L${l.id} · ${l.nome || descricaoLanche(l)}`])
};

function preencherSelects(form) {
    form.querySelectorAll("select[data-opcoes]").forEach(select => {
        const lista = opcoesSelect[select.dataset.opcoes]();
        select.innerHTML = opcoes(lista, lista.length ? "Selecione" : "Nenhum cadastrado");
    });
}

function valorCampo(campo) {
    if (campo instanceof RadioNodeList) return campo.value;
    const nome = campo.name || campo.dataset.campo;
    if (campo.type !== "number" && nome !== "id" && !nome.startsWith("fk_") && nome !== "unidade_id") return campo.value;
    return campo.value === "" ? null : Number(campo.value);
}

function lerFormulario(form) {
    const nomes = new Set([...form.elements].map(campo => campo.name).filter(Boolean));
    return Object.fromEntries([...nomes].map(nome => [nome, valorCampo(form.elements[nome])]));
}

function lerLinhas(form) {
    return [...form.querySelectorAll(".linha-item")].map(linha => {
        const item = linha.dataset.id ? { id: Number(linha.dataset.id) } : {};
        linha.querySelectorAll("[data-campo]").forEach(campo => item[campo.dataset.campo] = valorCampo(campo));
        return item;
    });
}

function preencherCampos(form, registro) {
    for (const [campo, valor] of Object.entries(registro)) {
        if (campo !== "id" && form.elements[campo]) form.elements[campo].value = valor ?? "";
    }
}

function preencherLinha(linha, item) {
    if (item.id) linha.dataset.id = item.id;
    linha.querySelectorAll("[data-campo]").forEach(campo => campo.value = item[campo.dataset.campo] ?? "");
}

function limparLinha(linha) {
    delete linha.dataset.id;
    linha.querySelectorAll("input").forEach(campo => campo.value = "");
    linha.querySelectorAll("select").forEach(campo => campo.selectedIndex = 0);
    return linha;
}

function definirLinhas(form, quantidade) {
    const lista = form.querySelector(".itens-form");
    [...lista.children].slice(1).forEach(linha => linha.remove());
    limparLinha(lista.firstElementChild);
    while (lista.children.length < quantidade) lista.append(limparLinha(lista.firstElementChild.cloneNode(true)));
    return [...lista.children];
}

function adicionarLinha(botao) {
    const lista = botao.previousElementSibling;
    const nova = limparLinha(lista.firstElementChild.cloneNode(true));
    lista.append(nova);
    const form = botao.closest("form");
    if (form.dataset.tabela === "agenda_entrega_empenho") preencherItensEmpenho(form);
    else if (form.dataset.tabela === "lanche") filtrarProdutosLanche(form, false);
    else sincronizar(nova);
}

function semRepetir(valores, mensagem) {
    if (new Set(valores).size !== valores.length) throw new banco.ErroBanco(mensagem);
}

function abrirFormulario(tabela, id, extras = {}) {
    const form = document.querySelector(`form[data-tabela="${tabela}"]`);
    const registro = id ? buscar(dados[tabela], id) : null;
    form.reset();
    form.querySelector(".erro-formulario")?.remove();
    preencherSelects(form);
    form.elements.id.value = registro ? registro.id : "";
    formularios[tabela].preencher(form, registro, extras);
    sincronizar(form);
    const excluir = form.querySelector("[data-excluir]");
    if (excluir) excluir.hidden = !registro;
    form.closest("dialog").showModal();
}

function preencherSimples(form, registro) {
    if (registro) preencherCampos(form, registro);
}

function salvarSimples(form) {
    return banco.salvar(form.dataset.tabela, lerFormulario(form));
}

// Alimento: restrição 1, a unidade base fica bloqueada quando já existe produto do alimento
function preencherAlimento(form, registro) {
    if (registro) preencherCampos(form, registro);
    form.elements.fk_unidade_medida.disabled = Boolean(registro) && doRegistro("produto", "fk_alimento", registro.id).length > 0;
}

// Produto: múltiplos/submúltiplos na criação e bloqueio dos campos estruturais na edição.
// O estoque local pode ser ajustado manualmente (divergência); o provisionado só é exibido.
function preencherProduto(form, registro) {
    if (registro) preencherCampos(form, registro);
    mostrarUnidade(form.elements.fk_alimento);
    const bloqueado = Boolean(registro);
    form.elements.embalagem.disabled = bloqueado;
    form.elements.quant_unit_base.disabled = bloqueado;
    form.elements.unidade_id.disabled = bloqueado;
    form.elements.quant_subitens.disabled = bloqueado;
    form.elements.nome_subitem.disabled = bloqueado;
    el("produto-provisionado").value = registro ? registro.estoque_provisionado : 0;
    el("produto-estoque-rotulo").textContent = registro ? "Estoque local (ajuste manual)" : "Estoque local";
}

function preencherPerda(form, registro, extras) {
    form.elements.data.max = hoje;
    form.elements.data.value = hoje;
    if (extras.produto) form.elements.fk_produto.value = extras.produto;
}

function salvarProduto(form) {
    const raw = lerFormulario(form);
    const alimento = buscar(dados.alimento, raw.fk_alimento);
    let quantBase = raw.quant_unit_base;
    if (alimento && raw.unidade_id && quantBase !== null) {
        quantBase = converterEntreUnidades(quantBase, raw.unidade_id, alimento.fk_unidade_medida);
    }
    const { unidade_id, ...dadosProduto } = raw;
    return banco.salvar("produto", { ...dadosProduto, quant_unit_base: quantBase });
}

function preencherAgendamento(form, registro, extras) {
    form.elements.data.min = registro ? "" : hoje;
    if (registro) return preencherCampos(form, registro);
    form.elements.data.value = extras.data || hoje;
    form.elements.turno.value = extras.turno || "manha";
}

function preencherCardapio(form, registro) {
    const itens = registro ? itensCardapio(registro.id) : [];
    if (registro) preencherCampos(form, registro);
    const linhas = definirLinhas(form, itens.length || 2);
    linhas.forEach((linha, i) => {
        if (itens[i]) {
            preencherLinha(linha, itens[i]);
            mostrarUnidadeLinha(linha.querySelector("[data-campo=fk_alimento]"));
        }
    });
}

function salvarCardapio(form) {
    const { id, nome, descricao } = lerFormulario(form);
    const itens = lerLinhas(form);
    semRepetir(itens.map(item => item.fk_alimento), "Um alimento aparece mais de uma vez no cardápio.");
    return banco.transacao(async t => {
        const cardapio = await t.salvar("cardapio", { id, nome, descricao });
        for (const item of itens) {
            const alimento = buscar(dados.alimento, item.fk_alimento);
            const quantBase = alimento && item.unidade_id
                ? converterEntreUnidades(item.quant, item.unidade_id, alimento.fk_unidade_medida)
                : item.quant;
            await t.salvar("item_cardapio", { fk_cardapio: cardapio, fk_alimento: item.fk_alimento, quant: quantBase, observacoes: item.observacoes });
        }
        for (const antigo of await t.buscar("item_cardapio", "fk_cardapio", cardapio))
            if (!itens.some(item => item.fk_alimento === antigo.fk_alimento)) await t.excluir("item_cardapio", [cardapio, antigo.fk_alimento]);
    });
}

// "extras.substitui": nova versão de um lanche já entregue (restrição 2). O formulário vem com os
// dados do lanche anterior; ao salvar, o anterior é finalizado como sobra.
function preencherLanche(form, registro, extras = {}) {
    const anterior = !registro && extras.substitui ? buscar(dados.lanche, Number(extras.substitui)) : null;
    const origem = registro || anterior;
    const itens = origem ? itensLanche(origem.id) : [];
    if (origem) preencherCampos(form, origem);
    form.elements.substitui.value = anterior ? anterior.id : "";
    const aviso = form.querySelector("[data-aviso-substituicao]");
    aviso.hidden = !anterior;
    if (anterior) aviso.querySelector("p").textContent = `Nova versão do lanche L${anterior.id}, que já foi entregue e não pode ser alterado. Ao salvar, o L${anterior.id} será finalizado como sobra e os agendamentos dele ainda não entregues passarão para o novo lanche.`;
    const linhas = definirLinhas(form, itens.length || 1);
    filtrarProdutosLanche(form, false);
    linhas.forEach((linha, i) => {
        if (itens[i]) {
            preencherLinha(linha, anterior ? { ...itens[i], id: undefined } : itens[i]);
            ajustarReferencia(linha);
        }
    });
}

// Só sugere os itens do cardápio quando o operador troca o cardápio (não ao abrir o formulário).
function aoMudarCardapioLanche(form, evento) {
    filtrarProdutosLanche(form, evento?.isTrusted !== false);
}

function filtrarProdutosLanche(form, autopreencher = false) {
    const cardapioId = Number(form.elements.fk_cardapio.value);
    const itensDoCardapio = itensCardapio(cardapioId);
    const alimentos = itensDoCardapio.map(item => item.fk_alimento);
    const permitidos = dados.produto.filter(p => alimentos.includes(p.fk_alimento));
    const textoVazio = !cardapioId ? "Selecione o cardápio" : permitidos.length ? "Selecione" : "Nenhum produto dos alimentos do cardápio";

    if (autopreencher && cardapioId) {
        const sugestoes = [];
        for (const itemCard of itensDoCardapio) {
            const prodsAlimento = permitidos.filter(p => p.fk_alimento === itemCard.fk_alimento);
            if (!prodsAlimento.length) continue;
            const prod = prodsAlimento[0];
            const unidAlim = unidadeAlimento(prod.fk_alimento);
            // Alimento em "un" não aceita a forma "unidade base": a quantidade do cardápio (em un)
            // precisa ser convertida para embalagens (inteiro/fração) ou subitens. Sem essa conversão
            // a linha caía em "inteiro" com a quantidade em un, contando embalagens inteiras.
            if (unidAlim === "un" && prod.quant_subitens === prod.quant_unit_base && prod.quant_subitens > 1
                && !Number.isInteger(itemCard.quant / prod.quant_unit_base)) {
                sugestoes.push({
                    fk_produto: prod.id,
                    forma_consumo: "subitens",
                    quant_consumida: itemCard.quant,
                    conversao_subitens: prod.quant_subitens
                });
            } else if (unidAlim === "un") {
                sugestoes.push({
                    fk_produto: prod.id,
                    forma_consumo: "inteiro",
                    quant_consumida: precisao(itemCard.quant / prod.quant_unit_base)
                });
            } else {
                sugestoes.push({
                    fk_produto: prod.id,
                    forma_consumo: "unidade_base",
                    quant_consumida: itemCard.quant
                });
            }
        }
        const linhas = definirLinhas(form, Math.max(sugestoes.length, 1));
        linhas.forEach(linha => {
            const select = linha.querySelector("[data-campo=fk_produto]");
            select.innerHTML = opcoes(permitidos.map(p => [p.id, nomeProduto(p)]), textoVazio);
            select.disabled = false;
        });
        sugestoes.forEach((sug, idx) => {
            preencherLinha(linhas[idx], sug);
            ajustarReferencia(linhas[idx]);
        });
        if (!sugestoes.length) ajustarReferencia(linhas[0]);
        return;
    }

    form.querySelectorAll("[data-campo=fk_produto]").forEach(select => {
        const atual = select.value;
        select.innerHTML = opcoes(permitidos.map(p => [p.id, nomeProduto(p)]), textoVazio);
        select.value = atual;
        if (select.selectedIndex < 0) select.selectedIndex = 0;
        select.disabled = !cardapioId;
        ajustarReferencia(select.closest(".linha-item"));
    });
}

function salvarLanche(form) {
    const { id, nome, fk_cardapio, descricao } = lerFormulario(form);
    const linhas = [...form.querySelectorAll(".linha-item")];
    const itens = [];

    for (const linha of linhas) {
        const item = linha.dataset.id ? { id: Number(linha.dataset.id) } : {};
        linha.querySelectorAll("[data-campo]").forEach(campo => item[campo.dataset.campo] = valorCampo(campo));
        if (!item.fk_produto && (item.quant_consumida === null || item.quant_consumida === "")) continue;
        itens.push(item);
    }

    const itensNormalizados = itens.map(item => {
        const produto = buscar(dados.produto, item.fk_produto);
        if (!produto) throw new banco.ErroBanco("Selecione o produto em todos os itens preenchidos.");
        let quant = item.quant_consumida;
        if (item.forma_consumo === "unidade_base" && item.unidade_id) {
            const alimento = buscar(dados.alimento, produto.fk_alimento);
            quant = converterEntreUnidades(quant, item.unidade_id, alimento.fk_unidade_medida);
        }
        if (item.forma_consumo === "subitens") {
            const conv = Number(item.conversao_subitens);
            if (!Number.isInteger(conv) || conv < 1 || conv > 9999) {
                throw new banco.ErroBanco("O campo conversão para subitens deve ser um número inteiro entre 1 e 9.999.");
            }
        }
        return {
            fk_produto: item.fk_produto,
            forma_consumo: item.forma_consumo,
            quant_consumida: quant,
            conversao_subitens: item.forma_consumo === "subitens" ? Number(item.conversao_subitens) : null
        };
    });

    // Validação de consistência entre as quantidades do lanche e o previsto no cardápio
    if (itensNormalizados.length > 0 && fk_cardapio) {
        const previstoPorAlimento = new Map(itensCardapio(fk_cardapio).map(ic => [ic.fk_alimento, ic.quant]));
        const consumidoPorAlimento = new Map();

        for (const item of itensNormalizados) {
            const produto = buscar(dados.produto, item.fk_produto);
            const embalagensPorLanche = banco.consumoPorLanche(item, produto);
            const quantBaseAlimento = precisao(embalagensPorLanche * produto.quant_unit_base);
            consumidoPorAlimento.set(produto.fk_alimento, precisao((consumidoPorAlimento.get(produto.fk_alimento) || 0) + quantBaseAlimento));
        }

        for (const [alimentoId, totalConsumido] of consumidoPorAlimento.entries()) {
            const previsto = previstoPorAlimento.get(alimentoId);
            if (previsto !== undefined && Math.abs(totalConsumido - previsto) > 0.005) {
                const alimento = buscar(dados.alimento, alimentoId);
                const sigla = siglaUnidade(alimento.fk_unidade_medida);
                throw new banco.ErroBanco(`Inconsistência com o cardápio para "${alimento.nome}": o cardápio prevê ${num(previsto)} ${sigla} por lanche, mas os itens somam ${num(totalConsumido)} ${sigla}.`);
            }
        }
    }

    const substitui = Number(form.elements.substitui.value) || null;
    return banco.transacao(async t => {
        if (id) for (const antigo of await t.buscar("item_lanche", "fk_lanche", id)) await t.excluir("item_lanche", antigo.id);
        const lanche = await t.salvar("lanche", { id, nome, fk_cardapio, descricao });
        for (const item of itensNormalizados) {
            await t.salvar("item_lanche", { fk_lanche: lanche, ...item });
        }
        // Restrição 2: os agendamentos ainda não entregues passam para o novo lanche e o anterior
        // é finalizado como sobra (o que estava planejado para ele deixa de ser consumido do estoque).
        if (substitui) {
            for (const agendado of await t.buscar("lanche_agendado", "fk_lanche", substitui))
                if (agendado.situacao === "agendado") await t.salvar("lanche_agendado", { ...agendado, fk_lanche: lanche });
            await t.salvar("lanche", { ...await t.obter("lanche", substitui), situacao: "sobra" });
        }
    });
}

function preencherEmpenho(form, registro, extras) {
    const itens = registro ? itensEmpenho(registro.id) : [];
    if (registro) preencherCampos(form, registro);
    form.elements.data_final.min = registro ? registro.data_inicial : "";
    const linhas = definirLinhas(form, itens.length || 1);
    linhas.forEach((linha, i) => itens[i] && preencherLinha(linha, itens[i]));
    if (!registro && extras.produto) preencherLinha(linhas[0], { fk_produto: Number(extras.produto), quant_empenhada: extras.quantidade });
}

function salvarEmpenho(form) {
    const { id, sigla, fk_fornecedor, data_inicial, data_final } = lerFormulario(form);
    const itens = lerLinhas(form);
    semRepetir(itens.map(item => item.fk_produto), "Um produto aparece mais de uma vez no empenho.");
    return banco.transacao(async t => {
        const empenho = await t.salvar("empenho", { id, sigla, fk_fornecedor, data_inicial, data_final });
        for (const antigo of await t.buscar("item_empenho", "fk_empenho", empenho))
            if (!itens.some(item => item.id === antigo.id)) await t.excluir("item_empenho", antigo.id);
        for (const item of itens) {
            const atual = item.id ? await t.obter("item_empenho", item.id) : {};
            await t.salvar("item_empenho", { ...atual, fk_empenho: empenho, fk_produto: item.fk_produto, quant_empenhada: item.quant_empenhada });
        }
    });
}

// Solicitar entrega de empenho com suporte a múltiplos produtos
function preencherSolicitacao(form, registro, extras) {
    const linhas = definirLinhas(form, 1);
    const produtoId = Number(extras.produto);
    const item = produtoId && itensVigentes(produtoId).filter(i => saldoItemEmpenho(i) > 0)
        .sort((a, b) => saldoItemEmpenho(b) - saldoItemEmpenho(a))[0];

    if (item) {
        form.elements.fk_empenho.value = item.fk_empenho;
        preencherItensEmpenho(form);
        const linha = linhas[0];
        linha.querySelector("[data-campo=fk_item_empenho]").value = item.id;
        limitarQuantidadeLinha(linha);
        linha.querySelector("[data-campo=quant_solicitada]").value = Math.min(Number(extras.quantidade) || 0, saldoItemEmpenho(item)) || "";
        linha.querySelector("[data-campo=data_prevista_entrega]").value = hoje;
    } else {
        preencherItensEmpenho(form);
    }
    form.querySelectorAll("[data-campo=data_prevista_entrega]").forEach(input => input.min = hoje);
}

function salvarSolicitacao(form) {
    const { fk_empenho, observacao } = lerFormulario(form);
    const itens = lerLinhas(form);
    if (!itens.length) throw new banco.ErroBanco("Adicione pelo menos um produto para solicitar entrega.");
    semRepetir(itens.map(i => i.fk_item_empenho), "O mesmo item do empenho foi selecionado mais de uma vez.");

    return banco.transacao(async t => {
        for (const item of itens) {
            await t.salvar("agenda_entrega_empenho", {
                fk_empenho,
                fk_item_empenho: item.fk_item_empenho,
                data_solicitacao: hoje,
                data_prevista_entrega: item.data_prevista_entrega,
                quant_solicitada: item.quant_solicitada,
                observacao: item.observacao || observacao || ""
            });
        }
    });
}

function mostrarUnidade(select) {
    const selectUnidade = el("produto-unidade-select");
    if (!select.value) {
        selectUnidade.innerHTML = `<option value="">—</option>`;
        selectUnidade.disabled = true;
        return;
    }
    const alimento = buscar(dados.alimento, Number(select.value));
    const compativeis = unidadesCompativeis(alimento.fk_unidade_medida);
    selectUnidade.innerHTML = opcoes(compativeis.map(u => [u.id, siglaUnidade(u.id)]));
    selectUnidade.value = alimento.fk_unidade_medida;
    selectUnidade.disabled = Boolean(select.form.elements.id.value);
}

function mostrarUnidadeLinha(select) {
    const linha = select.closest(".linha-item");
    const selectUnidade = linha.querySelector("[data-campo=unidade_id]");
    if (!select.value) {
        selectUnidade.innerHTML = `<option value="">—</option>`;
        selectUnidade.disabled = true;
        return;
    }
    const alimento = buscar(dados.alimento, Number(select.value));
    const compativeis = unidadesCompativeis(alimento.fk_unidade_medida);
    selectUnidade.innerHTML = opcoes(compativeis.map(u => [u.id, siglaUnidade(u.id)]));
    selectUnidade.value = alimento.fk_unidade_medida;
    selectUnidade.disabled = false;
}

const mascaras = {
    cnpj: valor => {
        const c = valor.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 14);
        return [c.slice(0, 2), c.slice(2, 5), c.slice(5, 8)].filter(Boolean).join(".") + (c.length > 8 ? `/${c.slice(8, 12)}` : "") + (c.length > 12 ? `-${c.slice(12)}` : "");
    },
    telefone: valor => {
        const d = valor.replace(/\D/g, "").slice(0, 11);
        if (d.length <= 2) return d && `(${d}`;
        const meio = d.length > 10 ? 5 : 4;
        return `(${d.slice(0, 2)}) ${d.slice(2, 2 + meio)}${d.length > 2 + meio ? `-${d.slice(2 + meio)}` : ""}`;
    }
};

function preencherItensEmpenho(form) {
    const empenho = buscar(dados.empenho, Number(form.elements.fk_empenho.value));
    const listaOpcoes = empenho
        ? itensEmpenho(empenho.id).map(item => {
            const produto = buscar(dados.produto, item.fk_produto);
            return [item.id, `${nomeProduto(produto)} · saldo ${num(saldoItemEmpenho(item))} ${embalagem(produto)}`];
        })
        : [];

    form.querySelectorAll(".linha-item").forEach(linha => {
        const select = linha.querySelector("[data-campo=fk_item_empenho]");
        const atual = select.value;
        select.innerHTML = empenho ? opcoes(listaOpcoes, "Selecione") : opcoes([], "Selecione o empenho");
        select.value = atual;
        if (select.selectedIndex < 0) select.selectedIndex = 0;
        select.disabled = !empenho;
        const dataInput = linha.querySelector("[data-campo=data_prevista_entrega]");
        if (dataInput && !dataInput.value) dataInput.value = hoje;
        if (dataInput) dataInput.min = hoje;
        limitarQuantidadeLinha(linha);
    });
}

function limitarQuantidadeLinha(linha) {
    const select = linha.querySelector("[data-campo=fk_item_empenho]");
    const item = buscar(dados.item_empenho, Number(select.value));
    const quantidade = linha.querySelector("[data-campo=quant_solicitada]");
    if (item) quantidade.max = saldoItemEmpenho(item);
    else quantidade.removeAttribute("max");
}

function ajustarReferencia(linha) {
    const produto = buscar(dados.produto, Number(linha.querySelector("[data-campo=fk_produto]").value));
    const referencia = linha.querySelector("[data-campo=forma_consumo]");
    const conversao = linha.querySelector("[data-campo=conversao_subitens]");
    const selectUnidade = linha.querySelector("[data-campo=unidade_id]");
    const textoUnidade = linha.querySelector("[data-unidade]");

    referencia.querySelector("[value=unidade_base]").disabled = Boolean(produto) && unidadeAlimento(produto.fk_alimento) === "un";
    // quant_subitens 0: o produto não pode ser particionado
    referencia.querySelector("[value=subitens]").disabled = Boolean(produto) && produto.quant_subitens === 0;
    if (referencia.selectedOptions[0].disabled) referencia.value = "inteiro";
    
    const ehSubitens = referencia.value === "subitens";
    conversao.disabled = !ehSubitens;
    conversao.placeholder = ehSubitens ? "Informe" : "Auto";
    if (!ehSubitens) {
        conversao.value = "";
    } else if (!conversao.value && produto?.quant_subitens) {
        conversao.value = produto.quant_subitens;
    }

    if (referencia.value === "unidade_base" && produto) {
        const alimento = buscar(dados.alimento, produto.fk_alimento);
        const compativeis = unidadesCompativeis(alimento.fk_unidade_medida);
        const valorAtual = Number(selectUnidade.value);
        selectUnidade.innerHTML = opcoes(compativeis.map(u => [u.id, siglaUnidade(u.id)]));
        selectUnidade.value = compativeis.some(u => u.id === valorAtual) ? valorAtual : alimento.fk_unidade_medida;
        selectUnidade.hidden = false;
        textoUnidade.hidden = true;
    } else {
        selectUnidade.hidden = true;
        textoUnidade.hidden = false;
        // "Inteiro ou fração" conta embalagens: mostra o conteúdo de cada uma para não confundir com kg/L.
        textoUnidade.textContent = referencia.value === "inteiro" && produto
            ? `${embalagem(produto)} (${num(produto.quant_unit_base)} ${unidadeAlimento(produto.fk_alimento)})`
            : unidadeConsumo(referencia.value, produto) || "—";
    }
}

// ---------------------------------------------------------------------------------------------
// Gravações

function mensagemDeErro(erro) {
    if (erro instanceof banco.ErroBanco) return erro.message;
    console.error(erro);
    return "Não foi possível concluir a operação. Veja os detalhes no console do navegador.";
}

function mostrarErroNoFormulario(form, texto) {
    const caixa = form.querySelector(".erro-formulario") || form.querySelector(".modal-corpo").appendChild(document.createElement("div"));
    caixa.className = "aviso aviso-erro erro-formulario";
    caixa.innerHTML = `${icone("error")}<span></span>`;
    caixa.lastElementChild.textContent = texto;
    caixa.scrollIntoView({ block: "nearest" });
}

async function executar(acao, mensagem, formulario) {
    try {
        await acao();
    } catch (erro) {
        if (formulario) mostrarErroNoFormulario(formulario, mensagemDeErro(erro));
        else mostrarToast(mensagemDeErro(erro), "erro");
        return false;
    }
    formulario?.closest("dialog").close();
    await atualizar();
    mostrarToast(mensagem);
    return true;
}

async function comBotao(botao, tarefa) {
    if (botao) botao.disabled = true;
    try {
        return await tarefa();
    } finally {
        if (botao) botao.disabled = false;
    }
}

function enviarFormulario(form) {
    const { salvar, salvo } = formularios[form.dataset.tabela];
    return executar(() => salvar(form), salvo, form);
}

function excluirRegistro(botao) {
    const tabela = botao.dataset.excluir;
    const id = Number(botao.dataset.id || botao.form?.elements.id.value);
    if (!id || !confirm("Excluir este registro? Esta ação não pode ser desfeita.")) return;
    const formulario = botao.closest("dialog") ? botao.form : null;
    return comBotao(botao, () => executar(() => banco.excluir(tabela, id), formularios[tabela].excluido, formulario));
}

function confirmarEntrega(form) {
    const agendado = buscar(dados.lanche_agendado, agendadoSelecionado);
    const qtdLanches = Number(form.elements.quant_entregue.value);
    if (!Number.isInteger(qtdLanches) || qtdLanches < 0 || qtdLanches > 9999) {
        mostrarToast("A quantidade entregue de lanches deve ser um número inteiro entre 0 e 9.999.", "erro");
        return;
    }
    const obsLanche = String(form.elements.observacoes.value || "").trim();
    if (obsLanche.length > 350) {
        mostrarToast("As observações do lanche não podem passar de 350 caracteres.", "erro");
        return;
    }
    const registro = { ...agendado, situacao: "entregue", quant_entregue: qtdLanches, observacoes: obsLanche };
    const perdas = [];
    const itens = [...form.querySelectorAll("[data-item-lanche]")].map(linha => {
        const qtdItem = precisao(Number(linha.querySelector("[data-campo=quant_entregue]").value));
        const obsItem = String(linha.querySelector("[data-campo=observacoes]").value || "").trim();
        if (!Number.isFinite(qtdItem) || qtdItem < 0 || qtdItem > 99999.999) {
            throw new banco.ErroBanco("A quantidade entregue do item deve estar entre 0 e 99.999,999.");
        }
        if (obsItem.length > 350) {
            throw new banco.ErroBanco("A observação do item não pode passar de 350 caracteres.");
        }
        // sobra que não volta ao estoque é registrada como perda
        const itemLanche = buscar(dados.item_lanche, Number(linha.dataset.itemLanche));
        const sobra = precisao(Number(linha.querySelector("[data-campo=quant_entregue]").dataset.planejado) - qtdItem);
        if (sobra > 0 && !linha.querySelector("[data-sobra-volta]").checked) {
            perdas.push({
                fk_produto: itemLanche.fk_produto,
                data: agendado.data,
                quantidade: sobra,
                motivo: `Sobra não reaproveitada do lanche L${agendado.fk_lanche} (${formatarData(agendado.data)}, ${turnos[agendado.turno]})`
            });
        }
        return {
            fk_lanche_agendado: agendado.id,
            fk_item_lanche: itemLanche.id,
            quant_entregue: qtdItem,
            observacoes: obsItem
        };
    });
    if (!confirm("Confirmar a entrega? Depois de registrada, ela não pode mais ser alterada.")) return;
    return executar(() => banco.transacao(async t => {
        await t.salvar("lanche_agendado", registro);
        for (const item of itens) await t.salvar("item_lanche_agendado", item);
        for (const perda of perdas) await t.salvar("perda", perda);
    }), perdas.length
        ? "Entrega registrada. Os produtos entregues saíram do estoque local e a sobra não reaproveitada foi registrada como perda."
        : "Entrega registrada. Os produtos entregues saíram do estoque local e a sobra continua nele.");
}

function registrarRecebimento(id, botao) {
    const card = botao.closest("[data-entrega]");
    const data = card.querySelector("[data-campo=data_entregue]");
    const quantidade = card.querySelector("[data-campo=quant_recebida]");
    if (!data.reportValidity() || !quantidade.reportValidity()) return;
    const entrega = buscar(dados.agenda_entrega_empenho, id);
    const qtdRec = precisao(Number(quantidade.value));
    if (!Number.isFinite(qtdRec) || qtdRec < 0 || qtdRec > 99999.999) {
        mostrarToast("Quantidade recebida deve estar entre 0 e 99.999,999.", "erro");
        return;
    }
    const total = precisao(entrega.quant_entregue + qtdRec);
    return comBotao(botao, () => executar(() => banco.salvar("agenda_entrega_empenho", {
        ...entrega,
        quant_entregue: total,
        data_entregue: data.value,
        observacao: card.querySelector("[data-campo=observacao]").value,
        estado: total >= entrega.quant_solicitada ? "entrega_total" : "entrega_parcial"
    }), "Recebimento registrado. O estoque local do produto foi atualizado."));
}

function finalizarEntrega(id, botao) {
    if (!confirm("Finalizar esta solicitação sem completar? O que falta receber volta ao saldo do empenho.")) return;
    const entrega = buscar(dados.agenda_entrega_empenho, id);
    const observacao = botao.closest("[data-entrega]").querySelector("[data-campo=observacao]").value;
    return comBotao(botao, () => executar(() => banco.salvar("agenda_entrega_empenho", { ...entrega, estado: "finalizado", observacao }),
        "Solicitação finalizada. O restante voltou ao saldo do empenho."));
}

// ---------------------------------------------------------------------------------------------
// Base de dados

function abrirBaseDados() {
    el("form-base-dados").querySelector(".erro-formulario")?.remove();
    document.body.classList.remove("menu-aberto");
    el("modal-base-dados").showModal();
}

async function exportarBanco() {
    const form = el("form-base-dados");
    form.querySelector(".erro-formulario")?.remove();
    try {
        const copia = await banco.exportar();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([JSON.stringify(copia, null, 2)], { type: "application/json" }));
        link.download = `merenda-ifrs-backup-${dataLocal(new Date())}.json`;
        form.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    } catch (erro) {
        mostrarErroNoFormulario(form, mensagemDeErro(erro));
        return;
    }
    el("modal-base-dados").close();
    mostrarToast("Banco de dados exportado. Guarde o arquivo baixado.");
}

async function importarBanco(input) {
    const arquivo = input.files[0];
    input.value = "";
    if (!arquivo) return;
    const form = input.form;
    form.querySelector(".erro-formulario")?.remove();

    let copia;
    try {
        copia = JSON.parse(await arquivo.text());
    } catch {
        mostrarErroNoFormulario(form, `Nada foi importado: "${arquivo.name}" não é um arquivo exportado por este sistema.`);
        return;
    }
    const exportadoEm = new Date(copia?.exportado_em);
    const quando = Number.isNaN(exportadoEm.getTime()) ? "" : `\nCópia exportada em ${exportadoEm.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.`;
    if (!confirm(`Importar "${arquivo.name}"?${quando}\n\nTodos os dados atuais deste aparelho serão substituídos pelos do arquivo. Esta ação não pode ser desfeita: se precisar dos dados atuais, exporte-os antes.`)) return;
    await executar(() => banco.importar(copia), "Banco de dados importado.", form);
}

// ---------------------------------------------------------------------------------------------
// Eventos

function filtrar(area) {
    const termo = (area.querySelector(".busca input")?.value || "").toLowerCase();
    const filtro = area.querySelector(".chips .ativo")?.dataset.filtro || "";
    area.querySelectorAll("[data-itens] > *").forEach(item => {
        if (item.matches(".linha-vazia, .vazio")) return;
        item.hidden = !item.textContent.toLowerCase().includes(termo) || (filtro && item.dataset.filtro !== filtro);
    });
}

let temporizadorToast;

function mostrarToast(texto, tipo = "ok") {
    const erro = tipo === "erro";
    el("toast-texto").textContent = texto;
    el("toast-icone").textContent = erro ? "error" : "check_circle";
    el("toast").classList.toggle("erro", erro);
    el("toast").classList.add("visivel");
    clearTimeout(temporizadorToast);
    temporizadorToast = setTimeout(() => el("toast").classList.remove("visivel"), erro ? 6000 : 2600);
}

document.addEventListener("click", evento => {
    const alvo = evento.target;

    const novo = alvo.closest("[data-novo]");
    if (novo) abrirFormulario(novo.dataset.novo, null, novo.dataset);

    const editar = alvo.closest("[data-editar]");
    if (editar && !editar.disabled) abrirFormulario(editar.dataset.editar, Number(editar.dataset.id));

    const excluir = alvo.closest("[data-excluir]");
    if (excluir && !excluir.disabled) excluirRegistro(excluir);

    const receber = alvo.closest("[data-receber]");
    if (receber && !receber.disabled) registrarRecebimento(Number(receber.dataset.receber), receber);

    const finalizar = alvo.closest("[data-finalizar]");
    if (finalizar && !finalizar.disabled) finalizarEntrega(Number(finalizar.dataset.finalizar), finalizar);

    if (alvo.closest("[data-fechar]")) alvo.closest("dialog").close();
    if (alvo.matches("dialog")) alvo.close();

    const chip = alvo.closest(".chips button");
    if (chip) {
        chip.parentElement.querySelectorAll("button").forEach(botao => botao.classList.toggle("ativo", botao === chip));
        filtrar(chip.closest("[data-filtragem]"));
    }

    const adicionar = alvo.closest("[data-adicionar]");
    if (adicionar) adicionarLinha(adicionar);

    const remover = alvo.closest("[data-remover]");
    if (remover && remover.closest(".itens-form").children.length > 1) remover.closest(".linha-item").remove();
});

document.addEventListener("submit", evento => {
    const form = evento.target;
    evento.preventDefault();
    if (form.id === "form-entrega") comBotao(evento.submitter, () => confirmarEntrega(form));
    else if (form.dataset.tabela) comBotao(evento.submitter, () => enviarFormulario(form));
});

document.addEventListener("input", evento => {
    const mascara = mascaras[evento.target.dataset.mascara];
    if (mascara) evento.target.value = mascara(evento.target.value);
    if (evento.target.closest(".busca")) filtrar(evento.target.closest("[data-filtragem]"));
});

async function iniciar() {
    el("data-hoje").textContent = new Date(`${hoje}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" });
    el("entrega-data").value = hoje;
    window.addEventListener("hashchange", navegar);
    navegar();
    try {
        await atualizar();
    } catch (erro) {
        console.error(erro);
        mostrarToast("Não foi possível abrir o banco de dados do navegador. Veja os detalhes no console.", "erro");
    }
}

iniciar();