// Banco de dados local do sistema (IndexedDB).

const banco = (() => {
    const NOME = "merenda-ifrs";
    const VERSAO = 8; // 8: campos da especificação v0.3 (ver migrar())

    class ErroBanco extends Error {
        constructor(mensagem) {
            super(mensagem);
            this.name = "ErroBanco";
        }
    }

    const falhar = mensagem => { throw new ErroBanco(mensagem); };
    const vazio = valor => valor === undefined || valor === null || valor === "";
    const arred = valor => Math.round(valor * 1000) / 1000;
    const emAberto = estado => estado === "agendado" || estado === "entrega_parcial";
    const hoje = () => {
        const agora = new Date();
        return [agora.getFullYear(), agora.getMonth() + 1, agora.getDate()].map(n => String(n).padStart(2, "0")).join("-");
    };

    const texto = (opcoes = {}) => ({ tipo: "texto", ...opcoes });
    const numero = (opcoes = {}) => ({ tipo: "numero", ...opcoes });
    const data = (opcoes = {}) => ({ tipo: "data", ...opcoes });
    const opcao = (valores, opcoes = {}) => ({ tipo: "opcao", valores, ...opcoes });
    const fk = (tabela, opcoes = {}) => ({ tipo: "fk", tabela, ...opcoes });

    const esquema = {
        grandeza: {
            rotulo: "grandeza",
            campos: { nome: texto() }
        },
        multiplo: {
            rotulo: "múltiplo",
            campos: { nome: texto(), sigla: texto(), valor: numero({ positivo: true, decimais: 6 }) } // micro = 0,000001
        },
        unidade_medida_basica: {
            rotulo: "unidade de medida básica",
            campos: { nome: texto(), sigla: texto(), fk_grandeza: fk("grandeza") }
        },
        unidade_medida: {
            rotulo: "unidade de medida",
            campos: {
                fk_unidade_medida_basica: fk("unidade_medida_basica"),
                fk_multiplo: fk("multiplo", { opcional: true })
            }
        },
        alimento: {
            rotulo: "alimento",
            campos: {
                nome: texto({ maxlength: 50 }),
                descricao: texto({ maxlength: 100 }),
                fk_unidade_medida: fk("unidade_medida"),
                natureza: opcao(["comida", "bebida"]),
                grupo: texto({ maxlength: 50 })
            },
            // Restrição 1: a unidade base não muda depois que existe produto do alimento. Sem
            // produtos, a troca é permitida; as quantidades dos cardápios são convertidas quando a
            // nova unidade é da mesma unidade básica (ex.: g -> Kg).
            antesDeSalvar: async (t, alimento, anterior) => {
                if (!anterior || anterior.fk_unidade_medida === alimento.fk_unidade_medida) return;
                const produtos = (await t.buscar("produto", "fk_alimento", alimento.id)).length;
                if (produtos)
                    falhar(`Não é possível alterar a unidade de medida base: já existe(m) ${produtos} produto(s) deste alimento. Cadastre um novo alimento com a outra unidade.`);
                const itens = await t.buscar("item_cardapio", "fk_alimento", alimento.id);
                if (!itens.length) return;
                const fator = await fatorConversao(t, anterior.fk_unidade_medida, alimento.fk_unidade_medida);
                if (fator === null)
                    falhar(`Não é possível alterar a unidade de medida base: o alimento é usado em ${itens.length} cardápio(s), com quantidades em ${await siglaDaUnidade(t, anterior.fk_unidade_medida)}, que não podem ser convertidas para ${await siglaDaUnidade(t, alimento.fk_unidade_medida)}.`);
                for (const item of itens) await t.salvar("item_cardapio", { ...item, quant: arred(item.quant * fator) });
            }
        },
        produto: {
            rotulo: "produto",
            campos: {
                fk_alimento: fk("alimento"),
                descricao: texto({ maxlength: 100 }),
                quant_unit_base: numero({ positivo: true, maximo: 99999.999 }),
                // 0 = o produto não pode ser particionado; 1 = pode, mas a quantidade ainda não é conhecida
                quant_subitens: numero({ inteiro: true, minimo: 0, maximo: 9999 }),
                // empenhado e ainda não entregue pelo fornecedor; só muda pelos empenhos e recebimentos
                estoque_provisionado: numero({ minimo: 0, maximo: 99999.999, padrao: 0 }),
                // já entregue e disponível; muda com recebimentos, entregas de lanche, sobras, perdas e ajuste manual
                estoque_local: numero({ minimo: 0, maximo: 99999.999, padrao: 0 }),
                nome_subitem: texto({ opcional: true, maxlength: 40 }),
                embalagem: texto({ opcional: true, maxlength: 20 })
            },
            antesDeSalvar: async (t, produto, anterior) => {
                // o estoque provisionado não é editado pela interface: começa em zero e só os empenhos o alteram
                if (!t.atualizacaoEstoque) produto.estoque_provisionado = anterior?.estoque_provisionado ?? 0;
                if (anterior && !t.atualizacaoEstoque) {
                    const bloqueados = ["embalagem", "quant_unit_base", "quant_subitens", "nome_subitem"];
                    for (const campo of bloqueados) {
                        if ((anterior[campo] ?? null) !== (produto[campo] ?? null)) {
                            falhar(`Produto: o campo "${campo}" não pode ser alterado após o cadastro do produto.`);
                        }
                    }
                }
                const alimentoAtual = await t.obter("alimento", produto.fk_alimento);
                if (alimentoAtual) {
                    const unidAtual = await t.obter("unidade_medida", alimentoAtual.fk_unidade_medida);
                    const basicaAtual = unidAtual ? await t.obter("unidade_medida_basica", unidAtual.fk_unidade_medida_basica) : null;
                    if (basicaAtual?.sigla === "un" && !unidAtual?.fk_multiplo && !Number.isInteger(produto.estoque_local)) {
                        falhar("Produto: para unidade 'un', o estoque local deve ser um número inteiro.");
                    }
                }
                if (!anterior || anterior.fk_alimento === produto.fk_alimento) return;
                for (const item of await t.buscar("item_lanche", "fk_produto", produto.id)) {
                    const lanche = await t.obter("lanche", item.fk_lanche);
                    if (!await alimentoNoCardapio(t, produto.fk_alimento, lanche.fk_cardapio))
                        falhar(`Não é possível trocar o alimento deste produto: ele é usado no lanche ${lanche.id}, e o novo alimento não está no cardápio desse lanche.`);
                }
            }
        },
        cardapio: {
            rotulo: "cardápio",
            campos: { nome: texto({ maxlength: 50 }), descricao: texto({ opcional: true, maxlength: 100 }) }
        },
        item_cardapio: {
            rotulo: "item de cardápio",
            chave: ["fk_cardapio", "fk_alimento"],
            campos: {
                fk_cardapio: fk("cardapio", { dono: true }),
                fk_alimento: fk("alimento"),
                quant: numero({ positivo: true, maximo: 99999.999 }),
                observacoes: texto({ opcional: true, maxlength: 200 })
            },
            antesDeExcluir: async (t, item) => {
                for (const lanche of await t.buscar("lanche", "fk_cardapio", item.fk_cardapio)) {
                    for (const itemLanche of await t.buscar("item_lanche", "fk_lanche", lanche.id)) {
                        const produto = await t.obter("produto", itemLanche.fk_produto);
                        if (produto.fk_alimento === item.fk_alimento)
                            falhar(`Não é possível tirar este alimento do cardápio: o lanche ${lanche.id} usa o produto "${await nomeDoProduto(t, produto)}".`);
                    }
                }
            }
        },
        lanche: {
            rotulo: "lanche",
            campos: {
                nome: texto({ maxlength: 50 }),
                fk_cardapio: fk("cardapio"),
                descricao: texto({ opcional: true, maxlength: 100 }),
                // restrição 2: um lanche já entregue não muda; para alterá-lo cria-se um novo lanche
                // e o anterior é finalizado como "sobra"
                situacao: opcao(["ativo", "sobra"], { padrao: "ativo" })
            },
            antesDeSalvar: async (t, lanche, anterior) => {
                if (!anterior) {
                    if (lanche.situacao !== "ativo") falhar("Um lanche novo deve começar ativo.");
                    return;
                }
                if (anterior.situacao === "sobra")
                    falhar(`O lanche ${lanche.id} foi finalizado como sobra e não pode mais ser alterado.`);
                if (lanche.situacao === "sobra") {
                    if (["nome", "fk_cardapio", "descricao"].some(campo => lanche[campo] !== anterior[campo]))
                        falhar("Ao finalizar um lanche como sobra, os demais dados dele não podem mudar.");
                    const pendentes = await esperar(t.loja("lanche_agendado").index("fk_lanche+situacao").count([lanche.id, "agendado"]));
                    if (pendentes)
                        falhar(`O lanche ${lanche.id} ainda tem ${pendentes} agendamento(s) a entregar. Passe esses agendamentos para o novo lanche antes de finalizá-lo.`);
                    return;
                }
                await exigirLancheEditavel(t, lanche.id);
                if (anterior.fk_cardapio === lanche.fk_cardapio) return;
                for (const item of await t.buscar("item_lanche", "fk_lanche", lanche.id)) {
                    const produto = await t.obter("produto", item.fk_produto);
                    if (!await alimentoNoCardapio(t, produto.fk_alimento, lanche.fk_cardapio))
                        falhar(`Não é possível trocar o cardápio: o produto "${await nomeDoProduto(t, produto)}" do lanche não está no novo cardápio.`);
                }
            },
            antesDeExcluir: (t, lanche) => exigirLancheEditavel(t, lanche.id)
        },
        item_lanche: {
            rotulo: "item de lanche",
            campos: {
                fk_lanche: fk("lanche", { dono: true }),
                fk_produto: fk("produto"),
                forma_consumo: opcao(["inteiro", "unidade_base", "subitens"]),
                quant_consumida: numero({ positivo: true, maximo: 99999.999 }),
                conversao_subitens: numero({ inteiro: true, minimo: 1, maximo: 9999, opcional: true }),
                // atribuída automaticamente conforme a forma de consumo; guardada para manter o
                // histórico caso a unidade base do alimento mude
                unidade_consumo: texto({ opcional: true, maxlength: 20 })
            },
            antesDeSalvar: async (t, item) => {
                await exigirLancheEditavel(t, item.fk_lanche);
                const lanche = await t.obter("lanche", item.fk_lanche);
                const produto = await t.obter("produto", item.fk_produto);
                if (lanche.situacao === "sobra")
                    falhar(`O lanche ${lanche.id} foi finalizado como sobra e não pode mais ser alterado.`);
                if (!await alimentoNoCardapio(t, produto.fk_alimento, lanche.fk_cardapio))
                    falhar(`O produto "${await nomeDoProduto(t, produto)}" não pode entrar no lanche: o alimento dele não está no cardápio do lanche.`);
                if (item.forma_consumo !== "subitens" && item.conversao_subitens !== null)
                    falhar('Item de lanche: conversao_subitens só é usado quando a forma de consumo é "subitens".');
                if (item.forma_consumo === "subitens" && produto.quant_subitens === 0)
                    falhar(`O produto "${await nomeDoProduto(t, produto)}" não pode ser particionado (quantidade de subitens 0). Use outra forma de consumo.`);
                if (item.forma_consumo === "subitens" && item.conversao_subitens === null)
                    falhar(`O produto "${await nomeDoProduto(t, produto)}": informe a conversão de subitens.`);
                const alimento = await t.obter("alimento", produto.fk_alimento);
                item.unidade_consumo = unidadeDeConsumo(item.forma_consumo, await siglaDaUnidade(t, alimento.fk_unidade_medida));
            },
            antesDeExcluir: (t, item) => exigirLancheEditavel(t, item.fk_lanche)
        },
        lanche_agendado: {
            rotulo: "lanche agendado",
            campos: {
                data: data(),
                turno: opcao(["manha", "tarde"]),
                fk_lanche: fk("lanche"),
                quantidade: numero({ positivo: true, inteiro: true, maximo: 9999 }),
                quant_entregue: numero({ minimo: 0, inteiro: true, maximo: 9999, opcional: true }),
                situacao: opcao(["agendado", "entregue"], { padrao: "agendado" }),
                observacoes: texto({ opcional: true, maxlength: 350 })
            },
            indices: ["data", ["fk_lanche", "situacao"]],
            antesDeSalvar: async (t, agendado, anterior) => {
                if (anterior) exigirEntregaAberta(t, anterior);
                if (anterior?.fk_lanche !== agendado.fk_lanche && (await t.obter("lanche", agendado.fk_lanche)).situacao === "sobra")
                    falhar(`O lanche ${agendado.fk_lanche} foi finalizado como sobra e não pode mais ser agendado. Use a nova versão dele.`);
                if (agendado.situacao === "entregue" && agendado.quant_entregue === null)
                    falhar("Informe a quantidade de lanches entregues para registrar a entrega.");
                if (agendado.situacao === "entregue" && anterior?.situacao !== "entregue" && agendado.data > hoje())
                    falhar(`A entrega só pode ser registrada a partir do dia agendado (${agendado.data.split("-").reverse().join("/")}).`);
                if (agendado.quant_entregue > agendado.quantidade)
                    falhar(`A quantidade de lanches entregues (${agendado.quant_entregue}) não pode passar da prevista (${agendado.quantidade}).`);
            },
            depoisDeSalvar: (t, agendado, id, anterior) => {
                if (agendado.situacao === "entregue" && anterior?.situacao !== "entregue") t.entregasRegistradas.add(id);
            },
            antesDeExcluir: (t, agendado) => exigirEntregaAberta(t, agendado)
        },
        item_lanche_agendado: {
            rotulo: "item de lanche agendado",
            chave: ["fk_lanche_agendado", "fk_item_lanche"],
            campos: {
                fk_lanche_agendado: fk("lanche_agendado", { dono: true }),
                fk_item_lanche: fk("item_lanche"),
                quant_entregue: numero({ minimo: 0, maximo: 99999.999 }),
                observacoes: texto({ opcional: true, maxlength: 350 })
            },
            antesDeSalvar: async (t, item) => {
                const agendado = await t.obter("lanche_agendado", item.fk_lanche_agendado);
                if (!t.entregasRegistradas.has(agendado.id))
                    falhar(agendado.situacao === "entregue"
                        ? `A entrega do lanche agendado ${agendado.id} já foi registrada e não pode mais ser alterada.`
                        : "Os itens entregues só podem ser gravados junto com o registro da entrega do lanche agendado.");
                const itemLanche = await t.obter("item_lanche", item.fk_item_lanche);
                if (itemLanche.fk_lanche !== agendado.fk_lanche)
                    falhar(`O item de lanche ${itemLanche.id} não faz parte do lanche ${agendado.fk_lanche}, que é o lanche agendado.`);
                const produto = await t.obter("produto", itemLanche.fk_produto);
                const planejado = consumoPorLanche(itemLanche, produto) * agendado.quantidade;
                if (item.quant_entregue > planejado + 0.0005 + 1e-9)
                    falhar(`"${await nomeDoProduto(t, produto)}": a quantidade entregue (${item.quant_entregue}) passa da planejada para este lanche (${arred(planejado)}).`);
            },
            // Na entrega, o planejado sai do estoque local e a sobra (planejado - entregue) volta para
            // ele; o efeito no estoque é só o entregue. Sobra que não pode ser reaproveitada é
            // registrada como perda (tabela "perda") na mesma transação.
            depoisDeSalvar: async (t, item, chave, anterior) => {
                const usado = arred(item.quant_entregue - (anterior?.quant_entregue ?? 0));
                if (!usado) return;
                const itemLanche = await t.obter("item_lanche", item.fk_item_lanche);
                await moverEstoque(t, itemLanche.fk_produto, { local: -usado }, "a entrega");
            },
            antesDeExcluir: async (t, item) => exigirEntregaAberta(t, await t.obter("lanche_agendado", item.fk_lanche_agendado))
        },
        fornecedor: {
            rotulo: "fornecedor",
            campos: {
                nome: texto({ maxlength: 150 }),
                cnpj: texto({ unico: true, maxlength: 18, formatar: formatarCnpj, validar: valor => cnpjValido(valor) || "deve ser um CNPJ válido (confira os números e os dígitos verificadores)" }),
                telefone: texto({ opcional: true, maxlength: 15, formatar: formatarTelefone, validar: valor => /^\([1-9]\d\) \d{4,5}-\d{4}$/.test(valor) || "deve ter DDD e 8 ou 9 dígitos, como (51) 3333-4444" }),
                email: texto({ opcional: true, maxlength: 254, validar: valor => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor) || "deve ser um e-mail válido, como nome@empresa.com.br" })
            }
        },
        empenho: {
            rotulo: "empenho",
            campos: {
                sigla: texto({ unico: true, maxlength: 15, validar: valor => /^[0-9A-Za-z]+$/.test(valor) || "deve conter apenas letras e números, sem espaços ou símbolos" }),
                fk_fornecedor: fk("fornecedor"),
                data_inicial: data(),
                data_final: data()
            },
            indices: ["data_final"],
            antesDeSalvar: (t, empenho) => {
                if (empenho.data_final < empenho.data_inicial)
                    falhar("A data final do empenho não pode ser anterior à data inicial.");
            }
        },
        item_empenho: {
            rotulo: "item de empenho",
            campos: {
                fk_empenho: fk("empenho", { dono: true }),
                fk_produto: fk("produto"),
                quant_empenhada: numero({ positivo: true, maximo: 99999.999 }),
                quant_entregue: numero({ minimo: 0, maximo: 99999.999, padrao: 0 })
            },
            antesDeSalvar: async (t, item, anterior) => {
                if (item.quant_entregue !== (anterior?.quant_entregue ?? 0) && !t.recebimentos.has(item.id))
                    falhar("A quantidade entregue do item de empenho só muda com o registro de recebimento das entregas.");
                if (item.quant_entregue > item.quant_empenhada)
                    falhar("A quantidade entregue não pode passar da quantidade empenhada.");
                if (!anterior) return;
                if (anterior.fk_produto !== item.fk_produto && (await t.buscar("agenda_entrega_empenho", "fk_item_empenho", item.id)).length)
                    falhar("Não é possível trocar o produto: este item de empenho já tem entregas solicitadas.");
                const comprometido = arred(item.quant_entregue + await aReceber(t, item.id));
                if (comprometido > item.quant_empenhada + 1e-9)
                    falhar(`A quantidade empenhada não pode ser menor que ${comprometido}, que é o já entregue mais o que está solicitado ao fornecedor.`);
            },
            // estoque provisionado do produto = empenhado - já entregue, somando todos os itens de empenho
            depoisDeSalvar: async (t, item, id, anterior) => {
                const aEntregar = registro => registro ? registro.quant_empenhada - registro.quant_entregue : 0;
                if (anterior && anterior.fk_produto !== item.fk_produto) {
                    await moverEstoque(t, anterior.fk_produto, { provisionado: -aEntregar(anterior) });
                    await moverEstoque(t, item.fk_produto, { provisionado: aEntregar(item) });
                    return;
                }
                const diferenca = arred(aEntregar(item) - aEntregar(anterior));
                if (diferenca) await moverEstoque(t, item.fk_produto, { provisionado: diferenca });
            },
            antesDeExcluir: (t, item) => moverEstoque(t, item.fk_produto, { provisionado: -(item.quant_empenhada - item.quant_entregue) })
        },
        agenda_entrega_empenho: {
            rotulo: "entrega de empenho",
            campos: {
                fk_empenho: fk("empenho"),
                fk_item_empenho: fk("item_empenho"),
                data_solicitacao: data(),
                data_prevista_entrega: data(),
                data_entregue: data({ opcional: true }),
                quant_solicitada: numero({ positivo: true, maximo: 99999.999 }),
                quant_entregue: numero({ minimo: 0, maximo: 99999.999, padrao: 0 }),
                observacao: texto({ opcional: true, maxlength: 350 }),
                estado: opcao(["agendado", "entrega_total", "entrega_parcial", "finalizado"], { padrao: "agendado" }),
                data: data({ opcional: true }) // data do registro no sistema, preenchida automaticamente
            },
            indices: ["estado", "data_prevista_entrega"],
            antesDeSalvar: async (t, entrega, anterior) => {
                entrega.data = anterior?.data ?? entrega.data ?? hoje();
                if (anterior && !emAberto(anterior.estado))
                    falhar("Esta solicitação de entrega já foi concluída e não pode mais ser alterada.");
                if (anterior && entrega.quant_entregue < anterior.quant_entregue)
                    falhar("A quantidade recebida não pode diminuir.");
                if (anterior?.quant_entregue > 0 && (anterior.fk_item_empenho !== entrega.fk_item_empenho || anterior.fk_empenho !== entrega.fk_empenho))
                    falhar("Não é possível trocar o item de uma entrega que já teve recebimento.");

                const item = await t.obter("item_empenho", entrega.fk_item_empenho);
                if (item.fk_empenho !== entrega.fk_empenho)
                    falhar(`O item de empenho ${item.id} não pertence ao empenho ${entrega.fk_empenho}.`);
                if (entrega.data_prevista_entrega < entrega.data_solicitacao)
                    falhar("A data prevista de entrega não pode ser anterior à data da solicitação.");
                if (entrega.quant_entregue > entrega.quant_solicitada)
                    falhar("A quantidade entregue não pode passar da quantidade solicitada.");
                if (entrega.estado === "entrega_total" && entrega.quant_entregue !== entrega.quant_solicitada)
                    falhar('No estado "entrega_total", a quantidade entregue deve ser igual à solicitada.');
                if (entrega.estado === "entrega_parcial" && !(entrega.quant_entregue > 0 && entrega.quant_entregue < entrega.quant_solicitada))
                    falhar('No estado "entrega_parcial", a quantidade entregue deve ser maior que zero e menor que a solicitada.');
                if ((entrega.estado === "entrega_total" || entrega.estado === "entrega_parcial") && !entrega.data_entregue)
                    falhar("Informe a data em que a entrega foi feita.");

                const jaContado = anterior?.fk_item_empenho === item.id ? anterior.quant_entregue : 0;
                const saldo = arred(item.quant_empenhada - (item.quant_entregue - jaContado) - await aReceber(t, item.id, entrega.id));
                const usado = emAberto(entrega.estado) ? entrega.quant_solicitada : entrega.quant_entregue;
                if (usado > saldo + 1e-9)
                    falhar(`A quantidade solicitada passa do saldo do item de empenho, que é ${Math.max(saldo, 0)}.`);
            },
            depoisDeSalvar: async (t, entrega, id, anterior) => {
                const recebido = arred(entrega.quant_entregue - (anterior?.quant_entregue ?? 0));
                if (!recebido) return;
                const item = await t.obter("item_empenho", entrega.fk_item_empenho);
                t.recebimentos.add(item.id);
                // o item de empenho tira o recebido do estoque provisionado; aqui ele entra no local
                await t.salvar("item_empenho", { ...item, quant_entregue: arred(item.quant_entregue + recebido) });
                await moverEstoque(t, item.fk_produto, { local: recebido });
            },
            antesDeExcluir: (t, entrega) => {
                if (entrega.quant_entregue > 0) falhar("Não é possível excluir uma entrega que já teve recebimento.");
            }
        },
        // Registro de perda de alimento: desconta do estoque local. Não é alterado depois de
        // gravado; excluir o registro devolve a quantidade ao estoque local.
        perda: {
            rotulo: "perda",
            campos: {
                fk_produto: fk("produto"),
                data: data(),
                quantidade: numero({ positivo: true, maximo: 99999.999 }), // em unidades do produto
                motivo: texto({ maxlength: 200 })
            },
            antesDeSalvar: (t, perda, anterior) => {
                if (anterior) falhar("Uma perda registrada não pode ser alterada. Exclua o registro e registre a perda novamente.");
                if (perda.data > hoje()) falhar("A data da perda não pode ser futura.");
            },
            depoisDeSalvar: (t, perda) => moverEstoque(t, perda.fk_produto, { local: -perda.quantidade }, "a perda"),
            antesDeExcluir: (t, perda) => moverEstoque(t, perda.fk_produto, { local: perda.quantidade })
        }
    };

    // Altera os estoques do produto (local e/ou provisionado) somando as diferenças informadas.
    async function moverEstoque(t, idProduto, { local = 0, provisionado = 0 }, operacao = "a operação") {
        const produto = await t.obter("produto", idProduto);
        const novoLocal = arred(produto.estoque_local + local);
        if (novoLocal < 0) {
            // o estoque é contado em embalagens; mostra também o equivalente na unidade base do alimento
            const alimento = await t.obter("alimento", produto.fk_alimento);
            const sigla = await siglaDaUnidade(t, alimento.fk_unidade_medida);
            const emb = produto.embalagem || "un";
            const qtd = valor => `${valor} ${emb} (${arred(valor * produto.quant_unit_base)} ${sigla})`;
            falhar(`Estoque local insuficiente de "${await nomeDoProduto(t, produto)}": o estoque tem ${qtd(produto.estoque_local)} e ${operacao} usa ${qtd(arred(-local))}. O estoque local é contado em embalagens (${emb} de ${produto.quant_unit_base} ${sigla}). Registre o recebimento do produto ou ajuste o estoque local no cadastro do produto.`);
        }
        t.atualizacaoEstoque = true;
        try {
            await t.salvar("produto", {
                ...produto,
                estoque_local: novoLocal,
                estoque_provisionado: Math.max(0, arred(produto.estoque_provisionado + provisionado))
            });
        } finally {
            t.atualizacaoEstoque = false;
        }
    }

    // Unidade de consumo do item do lanche, conforme a forma de consumo (especificação, Item_Lanche).
    function unidadeDeConsumo(forma, siglaBase) {
        if (forma === "inteiro") return "unidade";
        if (forma === "unidade_base") return siglaBase;
        return "subitens";
    }

    async function siglaDaUnidade(t, idUnidade) {
        const unidade = await t.obter("unidade_medida", idUnidade);
        if (!unidade) return "";
        const basica = await t.obter("unidade_medida_basica", unidade.fk_unidade_medida_basica);
        const multiplo = unidade.fk_multiplo ? await t.obter("multiplo", unidade.fk_multiplo) : null;
        return `${multiplo ? multiplo.sigla : ""}${basica ? basica.sigla : ""}`;
    }

    // Fator para converter uma quantidade da unidade "origem" para a "destino", ou null se as
    // unidades não forem da mesma unidade básica (ex.: g -> Kg dá 0,001; g -> L dá null).
    async function fatorConversao(t, origem, destino) {
        const [uOrigem, uDestino] = [await t.obter("unidade_medida", origem), await t.obter("unidade_medida", destino)];
        if (!uOrigem || !uDestino || uOrigem.fk_unidade_medida_basica !== uDestino.fk_unidade_medida_basica) return null;
        const valor = async unidade => unidade.fk_multiplo ? (await t.obter("multiplo", unidade.fk_multiplo)).valor : 1;
        return await valor(uOrigem) / await valor(uDestino);
    }

    async function exigirLancheEditavel(t, idLanche) {
        const entregas = await esperar(t.loja("lanche_agendado").index("fk_lanche+situacao").count([idLanche, "entregue"]));
        if (entregas) falhar(`O lanche ${idLanche} já foi entregue aos estudantes e não pode mais ser alterado.`);
    }

    function exigirEntregaAberta(t, agendado) {
        if (agendado.situacao === "entregue" && !t.entregasRegistradas.has(agendado.id))
            falhar(`A entrega do lanche agendado ${agendado.id} já foi registrada e não pode mais ser alterada.`);
    }

    async function alimentoNoCardapio(t, idAlimento, idCardapio) {
        return Boolean(await t.obter("item_cardapio", [idCardapio, idAlimento]));
    }

    async function nomeDoProduto(t, produto) {
        const alimento = await t.obter("alimento", produto.fk_alimento);
        return `${alimento.nome} · ${produto.descricao}`;
    }

    function consumoPorLanche(item, produto) {
        if (item.forma_consumo === "inteiro") return item.quant_consumida;
        if (item.forma_consumo === "unidade_base") return item.quant_consumida / produto.quant_unit_base;
        return item.quant_consumida / item.conversao_subitens;
    }

    function formatarCnpj(valor) {
        const c = valor.toUpperCase().replace(/[^0-9A-Z]/g, "");
        return c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : valor;
    }

    function cnpjValido(valor) {
        const c = valor.replace(/[./-]/g, "");
        if (!/^[0-9A-Z]{12}\d{2}$/.test(c) || /^(.)\1+$/.test(c)) return false;
        const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        const digito = tamanho => {
            const resto = [...c.slice(0, tamanho)].reduce((soma, caractere, i) => soma + (caractere.charCodeAt(0) - 48) * pesos[i + 13 - tamanho], 0) % 11;
            return resto < 2 ? 0 : 11 - resto;
        };
        return digito(12) === Number(c[12]) && digito(13) === Number(c[13]);
    }

    function formatarTelefone(valor) {
        const d = valor.replace(/\D/g, "");
        if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
        if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
        return valor;
    }

    async function aReceber(t, idItem, excetoEntrega) {
        return (await t.buscar("agenda_entrega_empenho", "fk_item_empenho", idItem))
            .filter(entrega => entrega.id !== excetoEntrega && emAberto(entrega.estado))
            .reduce((total, entrega) => total + entrega.quant_solicitada - entrega.quant_entregue, 0);
    }

    function tabelaDe(nome) {
        return Object.hasOwn(esquema, nome) ? esquema[nome] : falhar(`Tabela desconhecida: "${nome}".`);
    }

    function titulo(nome) {
        const rotulo = esquema[nome].rotulo;
        return rotulo[0].toUpperCase() + rotulo.slice(1);
    }

    const dataValida = valor => typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)
        && !Number.isNaN(Date.parse(valor)) && new Date(valor).toISOString().startsWith(valor);

    function casasDecimais(valor) {
        const str = String(valor);
        if (str.includes("e-")) return Number(str.split("e-")[1]);
        const partes = str.split(".");
        return partes[1] ? partes[1].length : 0;
    }

    function validarValor(nome, campo, def, valor) {
        const invalido = motivo => falhar(`${titulo(nome)}: o campo "${campo}" ${motivo}.`);
        if (def.tipo === "texto") {
            if (typeof valor !== "string") invalido("deve ser um texto");
            if (def.maxlength !== undefined && valor.length > def.maxlength) invalido(`não pode ter mais de ${def.maxlength} caracteres`);
        }
        if (def.tipo === "data" && !dataValida(valor)) invalido("deve ser uma data válida no formato AAAA-MM-DD");
        if (def.tipo === "opcao" && !def.valores.includes(valor)) invalido(`deve ser um destes valores: ${def.valores.join(", ")}`);
        if (def.tipo === "fk" && !Number.isInteger(valor)) invalido("deve ser o id (número inteiro) de um registro");
        if (def.validar) {
            const resultado = def.validar(valor);
            if (resultado !== true) invalido(resultado);
        }
        if (def.tipo === "numero") {
            if (typeof valor !== "number" || !Number.isFinite(valor)) invalido("deve ser um número");
            if (def.inteiro && !Number.isInteger(valor)) invalido("deve ser um número inteiro");
            if (!def.inteiro && casasDecimais(valor) > (def.decimais ?? 3)) invalido(`pode ter no máximo ${def.decimais ?? 3} casas decimais`);
            if (def.positivo && valor <= 0) invalido("deve ser maior que zero");
            if (def.minimo !== undefined && valor < def.minimo) invalido(`não pode ser menor que ${def.minimo}`);
            if (def.maximo !== undefined && valor > def.maximo) invalido(`não pode ser maior que ${def.maximo}`);
        }
    }

    function normalizar(nome, registro) {
        const tabela = tabelaDe(nome);
        const temId = !tabela.chave;
        if (typeof registro !== "object" || registro === null) falhar(`${titulo(nome)}: registro inválido.`);
        for (const campo of Object.keys(registro)) {
            if (!(temId && campo === "id") && !Object.hasOwn(tabela.campos, campo))
                falhar(`${titulo(nome)}: o campo "${campo}" não existe nesta tabela.`);
        }

        const dados = {};
        if (temId && !vazio(registro.id)) {
            if (!Number.isInteger(registro.id) || registro.id < 1) falhar(`${titulo(nome)}: id inválido.`);
            dados.id = registro.id;
        }
        for (const [campo, def] of Object.entries(tabela.campos)) {
            let valor = typeof registro[campo] === "string" ? registro[campo].trim() : registro[campo];
            if (def.formatar && typeof valor === "string" && valor) valor = def.formatar(valor);
            if (vazio(valor) && def.padrao !== undefined) valor = def.padrao;
            if (vazio(valor)) {
                if (!def.opcional) falhar(`${titulo(nome)}: o campo "${campo}" é obrigatório.`);
                dados[campo] = def.tipo === "texto" ? "" : null;
                continue;
            }
            validarValor(nome, campo, def, valor);
            dados[campo] = valor;
        }
        return dados;
    }

    async function salvar(t, nome, registro) {
        const tabela = tabelaDe(nome);
        const dados = normalizar(nome, registro);
        const chave = tabela.chave ? tabela.chave.map(campo => dados[campo]) : dados.id;
        const anterior = chave === undefined ? undefined : await t.obter(nome, chave);

        for (const [campo, def] of Object.entries(tabela.campos)) {
            const valor = dados[campo];
            if (vazio(valor)) continue;
            if (def.tipo === "fk") {
                if (!await t.obter(def.tabela, valor))
                    falhar(`${titulo(nome)}: não existe ${esquema[def.tabela].rotulo} com id ${valor}.`);
                if (def.dono && anterior && anterior[campo] !== valor)
                    falhar(`${titulo(nome)}: o campo "${campo}" não pode ser alterado.`);
            }
            if (def.unico) {
                const outro = await esperar(t.loja(nome).index(campo).getKey(valor));
                if (outro !== undefined && outro !== chave) falhar(`Já existe um ${tabela.rotulo} com ${campo} "${valor}".`);
            }
        }

        await tabela.antesDeSalvar?.(t, dados, anterior);
        const chaveSalva = await esperar(t.loja(nome).put(dados));
        await tabela.depoisDeSalvar?.(t, dados, chaveSalva, anterior);
        return chaveSalva;
    }

    const dependentes = nome => Object.entries(esquema).flatMap(([outra, tabela]) =>
        Object.entries(tabela.campos)
            .filter(([, def]) => def.tipo === "fk" && def.tabela === nome)
            .map(([campo, def]) => ({ tabela: outra, campo, dono: Boolean(def.dono) })));

    async function excluir(t, nome, chave) {
        const tabela = tabelaDe(nome);
        const registro = await t.obter(nome, chave);
        if (!registro) return false;
        await tabela.antesDeExcluir?.(t, registro);

        const ligados = dependentes(nome);
        for (const { tabela: outra, campo } of ligados.filter(d => !d.dono)) {
            const usos = await esperar(t.loja(outra).index(campo).count(chave));
            if (usos) falhar(`Não é possível excluir: este registro de ${tabela.rotulo} é usado em ${usos} registro(s) de ${esquema[outra].rotulo}.`);
        }
        for (const { tabela: outra, campo } of ligados.filter(d => d.dono)) {
            for (const item of await esperar(t.loja(outra).index(campo).getAllKeys(chave))) await excluir(t, outra, item);
        }
        await esperar(t.loja(nome).delete(chave));
        return true;
    }

    const esperar = pedido => new Promise((ok, falha) => {
        pedido.onsuccess = () => ok(pedido.result);
        pedido.onerror = () => falha(pedido.error);
    });

    function indicesDe(tabela) {
        const indices = {};
        for (const [campo, def] of Object.entries(tabela.campos)) {
            if (def.tipo === "fk" || def.unico) indices[campo] = { caminho: campo, unico: Boolean(def.unico) };
        }
        for (const caminho of tabela.indices || []) {
            indices[[].concat(caminho).join("+")] = { caminho, unico: false };
        }
        return indices;
    }

    function atualizarEstrutura(db, tx) {
        for (const [nome, tabela] of Object.entries(esquema)) {
            const loja = db.objectStoreNames.contains(nome)
                ? tx.objectStore(nome)
                : db.createObjectStore(nome, tabela.chave ? { keyPath: tabela.chave } : { keyPath: "id", autoIncrement: true });
            const desejados = indicesDe(tabela);
            for (const indice of Array.from(loja.indexNames)) {
                const atual = loja.index(indice), desejado = desejados[indice];
                if (!desejado || String(atual.keyPath) !== String(desejado.caminho) || atual.unique !== desejado.unico) loja.deleteIndex(indice);
            }
            for (const [indice, { caminho, unico }] of Object.entries(desejados)) {
                if (!loja.indexNames.contains(indice)) loja.createIndex(indice, caminho, { unique: unico });
            }
        }
    }

    async function cadastrarUnidades(tx) {
        if (await esperar(tx.objectStore("unidade_medida").count())) return;
        const inserir = (nome, registro) => esperar(tx.objectStore(nome).add(registro));

        const grandeza = {};
        for (const nome of ["massa", "volume", "comprimento", "quantidade"]) grandeza[nome] = await inserir("grandeza", { nome });

        const basica = {};
        for (const [nome, sigla, deGrandeza] of [["grama", "g", "massa"], ["litro", "L", "volume"], ["unidade", "un", "quantidade"], ["dúzia", "dz", "quantidade"]])
            basica[sigla] = await inserir("unidade_medida_basica", { nome, sigla, fk_grandeza: grandeza[deGrandeza] });

        const multiplo = {};
        for (const [nome, sigla, valor] of [["quilo", "K", 1000], ["mega", "M", 1000000], ["mili", "m", 0.001], ["micro", "u", 0.000001]])
            multiplo[nome] = await inserir("multiplo", { nome, sigla, valor });

        for (const [sigla, deMultiplo] of [["g", null], ["g", "quilo"], ["L", null], ["L", "mili"], ["un", null], ["dz", null]])
            await inserir("unidade_medida", { fk_unidade_medida_basica: basica[sigla], fk_multiplo: deMultiplo ? multiplo[deMultiplo] : null });
    }

    // Converte registros gravados por versões anteriores à 8 para os campos da especificação v0.3.
    // Recebe as tabelas como listas de registros e altera os registros no lugar. É usada ao
    // atualizar o banco do navegador e ao importar uma cópia exportada por uma versão anterior.
    function migrar(tabelas, versaoOrigem) {
        if (versaoOrigem >= 8) return;
        const lista = nome => Array.isArray(tabelas[nome]) ? tabelas[nome].filter(registro => registro && typeof registro === "object") : [];
        const porId = nome => new Map(lista(nome).map(registro => [registro.id, registro]));
        const unidades = porId("unidade_medida"), basicas = porId("unidade_medida_basica"), multiplos = porId("multiplo");
        const alimentos = porId("alimento"), produtos = porId("produto");
        const sigla = id => {
            const unidade = unidades.get(id);
            if (!unidade) return "";
            return `${multiplos.get(unidade.fk_multiplo)?.sigla ?? ""}${basicas.get(unidade.fk_unidade_medida_basica)?.sigla ?? ""}`;
        };

        for (const alimento of lista("alimento")) if (vazio(alimento.descricao)) alimento.descricao = alimento.nome;

        const provisionado = new Map();
        for (const item of lista("item_empenho"))
            provisionado.set(item.fk_produto, (provisionado.get(item.fk_produto) ?? 0) + item.quant_empenhada - (item.quant_entregue ?? 0));
        for (const produto of lista("produto")) {
            if (!("estoque_local" in produto)) produto.estoque_local = produto.total_estoque ?? 0;
            delete produto.total_estoque;
            produto.estoque_provisionado = Math.max(0, arred(provisionado.get(produto.id) ?? 0));
            if (vazio(produto.quant_subitens)) produto.quant_subitens = 1; // particionável, quantidade desconhecida
        }

        for (const item of lista("item_cardapio")) {
            if (!("observacoes" in item)) item.observacoes = item.descricao ?? "";
            delete item.descricao;
        }
        for (const lanche of lista("lanche")) lanche.situacao ??= "ativo";
        for (const item of lista("item_lanche")) {
            if (!("forma_consumo" in item)) item.forma_consumo = item.referencia_consumo;
            delete item.referencia_consumo;
            const alimento = alimentos.get(produtos.get(item.fk_produto)?.fk_alimento);
            item.unidade_consumo = unidadeDeConsumo(item.forma_consumo, alimento ? sigla(alimento.fk_unidade_medida) : "");
        }
        for (const agendado of lista("lanche_agendado")) {
            if (!("quantidade" in agendado)) agendado.quantidade = agendado.quant_prevista;
            delete agendado.quant_prevista;
        }
        for (const entrega of lista("agenda_entrega_empenho")) entrega.data ??= entrega.data_solicitacao;
    }

    async function migrarBanco(tx, versaoOrigem) {
        const nomes = ["unidade_medida", "unidade_medida_basica", "multiplo", "alimento", "produto", "item_empenho",
            "item_cardapio", "lanche", "item_lanche", "lanche_agendado", "agenda_entrega_empenho"];
        const tabelas = {};
        for (const nome of nomes) tabelas[nome] = await esperar(tx.objectStore(nome).getAll());
        migrar(tabelas, versaoOrigem);
        for (const nome of nomes) for (const registro of tabelas[nome]) await esperar(tx.objectStore(nome).put(registro));
    }

    let conexao = null;

    function abrir() {
        conexao ??= new Promise((ok, falha) => {
            const pedido = indexedDB.open(NOME, VERSAO);
            pedido.onupgradeneeded = evento => {
                const tx = pedido.transaction;
                atualizarEstrutura(pedido.result, tx);
                if (evento.oldVersion < 2) cadastrarUnidades(tx).catch(erro => { console.error(erro); tx.abort(); });
                else if (evento.oldVersion < 8) migrarBanco(tx, evento.oldVersion).catch(erro => { console.error(erro); tx.abort(); });
            };
            pedido.onblocked = () => console.warn("A atualização do banco está aguardando: feche as outras abas do sistema.");
            pedido.onsuccess = () => {
                const db = pedido.result;
                db.onversionchange = () => { db.close(); conexao = null; };
                ok(db);
            };
            pedido.onerror = () => { conexao = null; falha(pedido.error); };
        });
        return conexao;
    }

    function contexto(tx) {
        const loja = nome => (tabelaDe(nome), tx.objectStore(nome));
        const t = {
            loja,
            entregasRegistradas: new Set(),
            recebimentos: new Set(),
            atualizacaoEstoque: false,
            listar: nome => esperar(loja(nome).getAll()),
            obter: (nome, chave) => esperar(loja(nome).get(chave)),
            buscar: (nome, indice, valor) => esperar(loja(nome).index(indice).getAll(valor)),
            salvar: (nome, registro) => salvar(t, nome, registro),
            excluir: (nome, chave) => excluir(t, nome, chave)
        };
        return t;
    }

    async function transacao(operacao, modo) {
        const db = await abrir();
        const tx = db.transaction(Array.from(db.objectStoreNames), modo);
        const concluida = new Promise((ok, falha) => {
            tx.oncomplete = () => ok();
            tx.onabort = () => falha(tx.error);
        });
        concluida.catch(() => {});
        try {
            const resultado = await operacao(contexto(tx));
            await concluida;
            return resultado;
        } catch (erro) {
            try { tx.abort(); } catch {}
            throw erro;
        }
    }

    const exportar = () => transacao(async t => ({
        sistema: NOME,
        versao: VERSAO,
        exportado_em: new Date().toISOString(),
        tabelas: Object.fromEntries(await Promise.all(Object.keys(esquema).map(async nome => [nome, await t.listar(nome)])))
    }), "readonly");

    function validarCopia(copia) {
        if (copia?.sistema !== NOME || !Number.isInteger(copia.versao) || typeof copia.tabelas !== "object" || copia.tabelas === null)
            falhar("o arquivo não é uma cópia do banco de dados da merenda.");
        if (copia.versao > VERSAO)
            falhar("o arquivo foi gerado por uma versão mais nova do sistema. Atualize o sistema neste aparelho antes de importar.");
        for (const nome of Object.keys(copia.tabelas)) tabelaDe(nome);
        migrar(copia.tabelas, copia.versao);

        const tabelas = {};
        for (const [nome, tabela] of Object.entries(esquema)) {
            const lista = copia.tabelas[nome] ?? [];
            if (!Array.isArray(lista)) falhar(`a tabela de ${tabela.rotulo} está com formato inválido.`);
            const chaves = new Set();
            tabelas[nome] = lista.map(registro => {
                const dados = normalizar(nome, registro);
                const chave = tabela.chave ? JSON.stringify(tabela.chave.map(campo => dados[campo])) : dados.id;
                if (chave === undefined) falhar(`há um registro de ${tabela.rotulo} sem id.`);
                if (chaves.has(chave)) falhar(`o registro ${chave} de ${tabela.rotulo} aparece mais de uma vez.`);
                chaves.add(chave);
                return dados;
            });
            for (const [campo, def] of Object.entries(tabela.campos)) {
                if (!def.unico) continue;
                const valores = tabelas[nome].map(registro => registro[campo]);
                const repetido = valores.find((valor, i) => valores.indexOf(valor) !== i);
                if (repetido !== undefined) falhar(`há mais de um ${tabela.rotulo} com ${campo} "${repetido}".`);
            }
        }
        if (!tabelas.unidade_medida.length) falhar("o arquivo não tem as unidades de medida, que toda cópia exportada por este sistema tem.");

        const ids = Object.fromEntries(Object.entries(tabelas).map(([nome, lista]) => [nome, new Set(lista.map(registro => registro.id))]));
        for (const [nome, lista] of Object.entries(tabelas)) {
            for (const [campo, def] of Object.entries(esquema[nome].campos)) {
                if (def.tipo !== "fk") continue;
                const orfao = lista.find(registro => registro[campo] !== null && !ids[def.tabela].has(registro[campo]));
                if (orfao) falhar(`${esquema[nome].rotulo} aponta para ${esquema[def.tabela].rotulo} com id ${orfao[campo]}, que não existe no arquivo.`);
            }
        }
        return tabelas;
    }

    async function importar(copia) {
        let tabelas;
        try {
            tabelas = validarCopia(copia);
        } catch (erro) {
            throw erro instanceof ErroBanco ? new ErroBanco(`Nada foi importado: ${erro.message}`) : erro;
        }
        await transacao(async t => {
            for (const nome of Object.keys(esquema)) await esperar(t.loja(nome).clear());
            for (const [nome, lista] of Object.entries(tabelas))
                await Promise.all(lista.map(registro => esperar(t.loja(nome).add(registro))));
        }, "readwrite");
    }

    async function apagarBanco() {
        const atual = conexao;
        conexao = null;
        if (atual) (await atual.catch(() => null))?.close();
        await esperar(indexedDB.deleteDatabase(NOME));
    }

    abrir().catch(erro => console.error("Não foi possível abrir o banco local:", erro));

    return {
        ErroBanco,
        tabelas: Object.keys(esquema),
        consumoPorLanche,
        listar: nome => transacao(t => t.listar(nome), "readonly"),
        listarTudo: () => transacao(async t => {
            const tudo = {};
            await Promise.all(Object.keys(esquema).map(async nome => { tudo[nome] = await t.listar(nome); }));
            return tudo;
        }, "readonly"),
        obter: (nome, chave) => transacao(t => t.obter(nome, chave), "readonly"),
        buscar: (nome, indice, valor) => transacao(t => t.buscar(nome, indice, valor), "readonly"),
        salvar: (nome, registro) => transacao(t => t.salvar(nome, registro), "readwrite"),
        excluir: (nome, chave) => transacao(t => t.excluir(nome, chave), "readwrite"),
        transacao: operacao => transacao(t => operacao({
            listar: t.listar, obter: t.obter, buscar: t.buscar, salvar: t.salvar, excluir: t.excluir
        }), "readwrite"),
        exportar,
        importar,
        apagarBanco
    };
})();