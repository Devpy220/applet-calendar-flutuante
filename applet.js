// applet.js - Versão Melhorada
const Applet = imports.ui.applet;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const GLib = imports.gi.GLib;
const Tweener = imports.ui.tweener;
const Meta = imports.gi.Meta;
const Settings = imports.ui.settings;

class FloatingCalendarApplet extends Applet.TextIconApplet {
    constructor(orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);
        
        this.set_applet_icon_name("office-calendar");
        this.set_applet_tooltip("Calendário Flutuante");
        
        // Inicializar configurações
        this.settings = new Settings.AppletSettings(this, "calendario-flutuante@usuario", instance_id);
        this._vincularConfiguracoes();
        
        // Estado do calendário
        this.calendarioVisivel = false;
        this.dataAtual = new Date();
        this.dataSelecionada = new Date();
        this._arrastando = false;
        this._idTimeoutOcultarAuto = null;
        
        // Carregar posição salva se lembrar-posição estiver habilitado
        this.posicaoSalva = this.settings.getValue("remember-position") ? 
            this._carregarPosicao() : null;
        
        // Criar menu popup para controles
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        
        this._configurarMenu();
        this._criarCalendarioFlutuante();
        this._atualizarRotuloApplet();
        
        // Atualizar a cada minuto
        this._iniciarTimer();
        
        // Conectar eventos
        this.actor.connect('button-press-event', Lang.bind(this, this._aoPressionarBotao));
        
        // Iniciar com calendário visível se configurado
        if (this.settings.getValue("start-with-calendar")) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, Lang.bind(this, function() {
                this._mostrarCalendario();
                return false;
            }));
        }
    }
    
    _vincularConfiguracoes() {
        // Vincular todas as configurações e conectar aos sinais de mudança
        this.settings.bind("calendar-size", "tamanhoCalendario", this._aoMudarConfiguracoes.bind(this));
        this.settings.bind("transparency", "transparencia", this._aoMudarConfiguracoes.bind(this));
        this.settings.bind("border-radius", "raioBorda", this._aoMudarConfiguracoes.bind(this));
        this.settings.bind("background-color", "corFundo", this._aoMudarConfiguracoes.bind(this));
        this.settings.bind("accent-color", "corDestaque", this._aoMudarConfiguracoes.bind(this));
        this.settings.bind("text-color", "corTexto", this._aoMudarConfiguracoes.bind(this));
        this.settings.bind("default-position", "posicaoPadrao");
        this.settings.bind("remember-position", "lembrarPosicao");
        this.settings.bind("show-week-numbers", "mostrarNumerosSemana", this._aoMudarConfiguracoes.bind(this));
        this.settings.bind("start-with-calendar", "iniciarComCalendario");
        this.settings.bind("auto-hide", "ocultarAutomaticamente");
    }
    
    _aoMudarConfiguracoes() {
        if (this.atorCalendario) {
            this._atualizarEstiloCalendario();
            this._atualizarGradeCalendario();
        }
    }
    
    _carregarPosicao() {
        try {
            let arquivoPosicao = GLib.get_user_config_dir() + '/cinnamon/floating-calendar-position.json';
            if (GLib.file_test(arquivoPosicao, GLib.FileTest.EXISTS)) {
                let [sucesso, conteudo] = GLib.file_get_contents(arquivoPosicao);
                if (sucesso) {
                    return JSON.parse(conteudo.toString());
                }
            }
        } catch (e) {
            global.logError("Erro ao carregar posição do calendário: " + e);
        }
        return null;
    }
    
    _salvarPosicao() {
        if (!this.lembrarPosicao || !this.atorCalendario) return;
        
        try {
            let posicao = {
                x: this.atorCalendario.x,
                y: this.atorCalendario.y
            };
            let arquivoPosicao = GLib.get_user_config_dir() + '/cinnamon/floating-calendar-position.json';
            GLib.file_set_contents(arquivePosicao, JSON.stringify(posicao));
        } catch (e) {
            global.logError("Erro ao salvar posição do calendário: " + e);
        }
    }
    
    _configurarMenu() {
        // Toggle calendário
        this.itemAlternar = new PopupMenu.PopupMenuItem("Mostrar Calendário");
        this.itemAlternar.connect('activate', Lang.bind(this, this._alternarCalendario));
        this.menu.addMenuItem(this.itemAlternar);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Posição do calendário
        let submenuPosicao = new PopupMenu.PopupSubMenuMenuItem("Posição na Tela");
        
        let posicoes = [
            {nome: "Centro", pos: "center"},
            {nome: "Canto Superior Direito", pos: "top-right"},
            {nome: "Canto Superior Esquerdo", pos: "top-left"},
            {nome: "Canto Inferior Direito", pos: "bottom-right"},
            {nome: "Canto Inferior Esquerdo", pos: "bottom-left"}
        ];
        
        posicoes.forEach(pos => {
            let item = new PopupMenu.PopupMenuItem(pos.nome);
            item.connect('activate', Lang.bind(this, function() {
                this._moverCalendarioPara(pos.pos);
            }));
            submenuPosicao.menu.addMenuItem(item);
        });
        
        this.menu.addMenuItem(submenuPosicao);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Item para hoje
        let itemHoje = new PopupMenu.PopupMenuItem("Ir para Hoje");
        itemHoje.connect('activate', Lang.bind(this, this._irParaHoje));
        this.menu.addMenuItem(itemHoje);
        
        // Configurações
        let itemConfiguracoes = new PopupMenu.PopupMenuItem("Configurações");
        itemConfiguracoes.connect('activate', Lang.bind(this, function() {
            this.configureApplet();
        }));
        this.menu.addMenuItem(itemConfiguracoes);
    }
    
    _criarCalendarioFlutuante() {
        // Container principal do calendário flutuante
        this.atorCalendario = new St.BoxLayout({
            style_class: 'calendar-container',
            vertical: true,
            reactive: true,
            track_hover: true
        });
        
        this._atualizarEstiloCalendario();
        
        // Cabeçalho com controles
        this._criarCabecalhoCalendario();
        
        // Grade do calendário
        this._criarGradeCalendario();
        
        // Adicionar à tela
        Main.uiGroup.add_actor(this.atorCalendario);
        this.atorCalendario.hide();
        
        // Tornar arrastável
        this._tornarArrastavel();
        
        // Posicionar
        if (this.posicaoSalva) {
            this.atorCalendario.set_position(this.posicaoSalva.x, this.posicaoSalva.y);
        } else {
            this._moverCalendarioPara(this.posicaoPadrao || 'center');
        }
    }
    
    _atualizarEstiloCalendario() {
        if (!this.atorCalendario) return;
        
        let tamanho = this._obterTamanhoCalendario();
        let transparencia = this.transparencia || 95;
        let raioBorda = this.raioBorda || 15;
        let corFundo = this.corFundo || 'rgba(40, 40, 40, 0.95)';
        
        let estilo = `
            background: ${corFundo};
            border: 2px solid ${this.corDestaque || '#4a90e2'};
            border-radius: ${raioBorda}px;
            padding: ${tamanho.preenchimento}px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
        `;
        
        this.atorCalendario.set_style(estilo);
    }
    
    _obterTamanhoCalendario() {
        switch (this.tamanhoCalendario) {
            case 'pequeno':
                return { preenchimento: 15, tamanhoFonte: 14, tamanhoDia: 35 };
            case 'grande':
                return { preenchimento: 25, tamanhoFonte: 20, tamanhoDia: 50 };
            default:
                return { preenchimento: 20, tamanhoFonte: 16, tamanhoDia: 40 };
        }
    }
    
    _criarCabecalhoCalendario() {
        // Container do cabeçalho
        let caixaCabecalho = new St.BoxLayout({
            style: 'spacing: 10px; margin-bottom: 15px;',
            x_align: Clutter.ActorAlign.CENTER
        });
        
        let tamanho = this._obterTamanhoCalendario();
        let corDestaque = this.corDestaque || '#4a90e2';
        
        // Botão anterior
        let estiloBotaoAnterior = `
            background: ${corDestaque};
            border-radius: 20px;
            padding: 8px 12px;
            color: white;
            font-weight: bold;
            font-size: ${tamanho.tamanhoFonte - 2}px;
        `;
        
        this.botaoAnterior = new St.Button({
            style: estiloBotaoAnterior,
            label: '◀'
        });
        this.botaoAnterior.connect('clicked', Lang.bind(this, this._mesAnterior));
        
        // Rótulo do mês/ano
        this.rotuloMes = new St.Label({
            style: `
                font-size: ${tamanho.tamanhoFonte + 2}px;
                font-weight: bold;
                color: ${this.corTexto || 'white'};
                text-align: center;
                min-width: 200px;
            `
        });
        
        // Botão próximo
        this.botaoProximo = new St.Button({
            style: estiloBotaoAnterior,
            label: '▶'
        });
        this.botaoProximo.connect('clicked', Lang.bind(this, this._proximoMes));
        
        // Botão fechar
        this.botaoFechar = new St.Button({
            style: `
                background: #e74c3c;
                border-radius: 15px;
                padding: 5px 10px;
                color: white;
                font-weight: bold;
                margin-left: 20px;
                font-size: ${tamanho.tamanhoFonte - 2}px;
            `,
            label: '✕'
        });
        this.botaoFechar.connect('clicked', Lang.bind(this, this._ocultarCalendario));
        
        caixaCabecalho.add_child(this.botaoAnterior);
        caixaCabecalho.add_child(this.rotuloMes);
        caixaCabecalho.add_child(this.botaoProximo);
        caixaCabecalho.add_child(this.botaoFechar);
        
        this.atorCalendario.add_child(caixaCabecalho);
    }
    
    _criarGradeCalendario() {
        // Container da grade
        this.containerGrade = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 5px;'
        });
        
        // Cabeçalho dos dias da semana
        let cabecalhoSemana = new St.BoxLayout({
            style: 'spacing: 5px; margin-bottom: 10px;'
        });
        
        // Adicionar coluna de cabeçalho de números de semana se habilitado
        if (this.mostrarNumerosSemana) {
            let cabecalhoNumSemana = new St.Label({
                text: 'S',
                style: `
                    font-weight: bold;
                    color: ${this.corDestaque || '#4a90e2'};
                    text-align: center;
                    min-width: 30px;
                    font-size: 10px;
                `
            });
            cabecalhoSemana.add_child(cabecalhoNumSemana);
        }
        
        const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        diasSemana.forEach(dia => {
            let tamanho = this._obterTamanhoCalendario();
            let rotuloDia = new St.Label({
                text: dia,
                style: `
                    font-weight: bold;
                    color: ${this.corDestaque || '#4a90e2'};
                    text-align: center;
                    min-width: ${tamanho.tamanhoDia}px;
                    font-size: ${tamanho.tamanhoFonte - 4}px;
                `
            });
            cabecalhoSemana.add_child(rotuloDia);
        });
        
        this.containerGrade.add_child(cabecalhoSemana);
        this.atorCalendario.add_child(this.containerGrade);
        
        this._atualizarGradeCalendario();
    }
    
    _atualizarGradeCalendario() {
        // Remover grade anterior (exceto o cabeçalho)
        let filhos = this.containerGrade.get_children();
        for (let i = 1; i < filhos.length; i++) {
            filhos[i].destroy();
        }
        
        // Atualizar rótulo do mês
        const meses = [
            'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
        ];
        this.rotuloMes.set_text(`${meses[this.dataAtual.getMonth()]} ${this.dataAtual.getFullYear()}`);
        
        // Calcular dias do mês
        let primeiroDia = new Date(this.dataAtual.getFullYear(), this.dataAtual.getMonth(), 1);
        let ultimoDia = new Date(this.dataAtual.getFullYear(), this.dataAtual.getMonth() + 1, 0);
        let dataInicio = new Date(primeiroDia);
        dataInicio.setDate(dataInicio.getDate() - primeiroDia.getDay());
        
        let hoje = new Date();
        let semanaAtual = new St.BoxLayout({style: 'spacing: 5px;'});
        let tamanho = this._obterTamanhoCalendario();
        
        // Adicionar número da semana se habilitado
        if (this.mostrarNumerosSemana) {
            let numSemana = this._obterNumeroSemana(dataInicio);
            let rotuloSemana = new St.Label({
                text: numSemana.toString(),
                style: `
                    color: #666;
                    text-align: center;
                    min-width: 30px;
                    font-size: 10px;
                    padding-top: 5px;
                `
            });
            semanaAtual.add_child(rotuloSemana);
        }
        
        for (let i = 0; i < 42; i++) {
            let diaAtual = new Date(dataInicio);
            diaAtual.setDate(dataInicio.getDate() + i);
            
            let eMesAtual = diaAtual.getMonth() === this.dataAtual.getMonth();
            let eHoje = diaAtual.toDateString() === hoje.toDateString();
            let eSelecionado = diaAtual.toDateString() === this.dataSelecionada.toDateString();
            
            let estiloDia = `
                min-width: ${tamanho.tamanhoDia}px;
                min-height: ${tamanho.tamanhoDia - 10}px;
                text-align: center;
                border-radius: 5px;
                padding: 5px;
                font-size: ${tamanho.tamanhoFonte - 2}px;
            `;
            
            if (eHoje) {
                estiloDia += `
                    background: #e74c3c;
                    color: white;
                    font-weight: bold;
                `;
            } else if (eSelecionado) {
                estiloDia += `
                    background: ${this.corDestaque || '#4a90e2'};
                    color: white;
                    font-weight: bold;
                `;
            } else if (eMesAtual) {
                estiloDia += `
                    color: ${this.corTexto || 'white'};
                    background: rgba(255, 255, 255, 0.1);
                `;
            } else {
                estiloDia += `
                    color: #666;
                    background: rgba(255, 255, 255, 0.05);
                `;
            }
            
            let botaoDia = new St.Button({
                label: diaAtual.getDate().toString(),
                style: estiloDia,
                reactive: true
            });
            
            // Armazenar a data no botão
            botaoDia._data = new Date(diaAtual);
            
            botaoDia.connect('clicked', Lang.bind(this, function(botao) {
                this.dataSelecionada = new Date(botao._data);
                this._atualizarGradeCalendario();
                
                // Mostrar data selecionada no tooltip do applet
                this.set_applet_tooltip(`Calendário - ${this.dataSelecionada.toLocaleDateString('pt-BR')}`);
                
                // Reiniciar timer de ocultar automaticamente
                this._reiniciarTimerOcultarAuto();
            }));
            
            semanaAtual.add_child(botaoDia);
            
            if ((i + 1) % 7 === 0) {
                this.containerGrade.add_child(semanaAtual);
                semanaAtual = new St.BoxLayout({style: 'spacing: 5px;'});
                
                // Adicionar número da semana para próxima semana se habilitado
                if (this.mostrarNumerosSemana && i < 35) {
                    let proximaDataSemana = new Date(diaAtual);
                    proximaDataSemana.setDate(proximaDataSemana.getDate() + 1);
                    let numSemana = this._obterNumeroSemana(proximaDataSemana);
                    let rotuloSemana = new St.Label({
                        text: numSemana.toString(),
                        style: `
                            color: #666;
                            text-align: center;
                            min-width: 30px;
                            font-size: 10px;
                            padding-top: 5px;
                        `
                    });
                    semanaAtual.add_child(rotuloSemana);
                }
            }
        }
    }
    
    _obterNumeroSemana(data) {
        let alvo = new Date(data.valueOf());
        let numeroDia = (data.getDay() + 6) % 7;
        alvo.setDate(alvo.getDate() - numeroDia + 3);
        let primeiraQuinta = alvo.valueOf();
        alvo.setMonth(0, 1);
        if (alvo.getDay() !== 4) {
            alvo.setMonth(0, 1 + ((4 - alvo.getDay()) + 7) % 7);
        }
        return 1 + Math.ceil((primeiraQuinta - alvo) / 604800000);
    }
    
    _tornarArrastavel() {
        this.atorCalendario.connect('button-press-event', Lang.bind(this, function(ator, evento) {
            if (evento.get_button() === 1) {
                this._inicioArrasteX = evento.get_coords()[0];
                this._inicioArrasteY = evento.get_coords()[1];
                this._inicioArrasteAtorX = ator.x;
                this._inicioArrasteAtorY = ator.y;
                this._arrastando = true;
                
                this._idMovimentoArraste = global.stage.connect('motion-event', Lang.bind(this, this._aoMovimentoArraste));
                this._idFimArraste = global.stage.connect('button-release-event', Lang.bind(this, this._aoFimArraste));
                
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }));
    }
    
    _aoMovimentoArraste(ator, evento) {
        if (!this._arrastando) return Clutter.EVENT_PROPAGATE;
        
        let [x, y] = evento.get_coords();
        let deltaX = x - this._inicioArrasteX;
        let deltaY = y - this._inicioArrasteY;
        
        this.atorCalendario.set_position(
            this._inicioArrasteAtorX + deltaX,
            this._inicioArrasteAtorY + deltaY
        );
        
        return Clutter.EVENT_STOP;
    }
    
    _aoFimArraste(ator, evento) {
        if (!this._arrastando) return Clutter.EVENT_PROPAGATE;
        
        this._arrastando = false;
        global.stage.disconnect(this._idMovimentoArraste);
        global.stage.disconnect(this._idFimArraste);
        
        // Salvar posição se lembrar-posição estiver habilitado
        this._salvarPosicao();
        
        return Clutter.EVENT_STOP;
    }
    
    _moverCalendarioPara(posicao) {
        if (!this.atorCalendario) return;
        
        let monitor = Main.layoutManager.primaryMonitor;
        let x, y;
        
        switch (posicao) {
            case 'center':
                x = monitor.x + (monitor.width - this.atorCalendario.width) / 2;
                y = monitor.y + (monitor.height - this.atorCalendario.height) / 2;
                break;
            case 'top-right':
                x = monitor.x + monitor.width - this.atorCalendario.width - 50;
                y = monitor.y + 50;
                break;
            case 'top-left':
                x = monitor.x + 50;
                y = monitor.y + 50;
                break;
            case 'bottom-right':
                x = monitor.x + monitor.width - this.atorCalendario.width - 50;
                y = monitor.y + monitor.height - this.atorCalendario.height - 100;
                break;
            case 'bottom-left':
                x = monitor.x + 50;
                y = monitor.y + monitor.height - this.atorCalendario.height - 100;
                break;
        }
        
        this.atorCalendario.set_position(x, y);
        this._salvarPosicao();
    }
    
    _mesAnterior() {
        this.dataAtual.setMonth(this.dataAtual.getMonth() - 1);
        this._atualizarGradeCalendario();
        this._reiniciarTimerOcultarAuto();
    }
    
    _proximoMes() {
        this.dataAtual.setMonth(this.dataAtual.getMonth() + 1);
        this._atualizarGradeCalendario();
        this._reiniciarTimerOcultarAuto();
    }
    
    _irParaHoje() {
        this.dataAtual = new Date();
        this.dataSelecionada = new Date();
        this._atualizarGradeCalendario();
        this._reiniciarTimerOcultarAuto();
    }
    
    _aoPressionarBotao(ator, evento) {
        if (evento.get_button() === 1) {
            this._alternarCalendario();
        } else if (evento.get_button() === 3) {
            this.menu.toggle();
        }
        return true;
    }
    
    _alternarCalendario() {
        if (this.calendarioVisivel) {
            this._ocultarCalendario();
        } else {
            this._mostrarCalendario();
        }
    }
    
    _mostrarCalendario() {
        this.atorCalendario.show();
        this.calendarioVisivel = true;
        this.itemAlternar.label.set_text("Ocultar Calendário");
        
        // Iniciar timer de ocultar automaticamente se configurado
        this._reiniciarTimerOcultarAuto();
        
        // Animação de entrada
        this.atorCalendario.set_scale(0.8, 0.8);
        this.atorCalendario.opacity = 0;
        
        Tweener.addTween(this.atorCalendario, {
            scale_x: 1.0,
            scale_y: 1.0,
            opacity: 255,
            time: 0.3,
            transition: 'easeOutQuart'
        });
    }
    
    _ocultarCalendario() {
        // Limpar timer de ocultar automaticamente
        if (this._idTimeoutOcultarAuto) {
            GLib.source_remove(this._idTimeoutOcultarAuto);
            this._idTimeoutOcultarAuto = null;
        }
        
        // Animação de saída
        Tweener.addTween(this.atorCalendario, {
            scale_x: 0.8,
            scale_y: 0.8,
            opacity: 0,
            time: 0.2,
            transition: 'easeInQuart',
            onComplete: Lang.bind(this, function() {
                this.atorCalendario.hide();
            })
        });
        
        this.calendarioVisivel = false;
        this.itemAlternar.label.set_text("Mostrar Calendário");
    }
    
    _reiniciarTimerOcultarAuto() {
        if (this._idTimeoutOcultarAuto) {
            GLib.source_remove(this._idTimeoutOcultarAuto);
            this._idTimeoutOcultarAuto = null;
        }
        
        if (this.ocultarAutomaticamente > 0 && this.calendarioVisivel) {
            this._idTimeoutOcultarAuto = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                this.ocultarAutomaticamente,
                Lang.bind(this, function() {
                    this._ocultarCalendario();
                    this._idTimeoutOcultarAuto = null;
                    return false;
                })
            );
        }
    }
    
    _atualizarRotuloApplet() {
        let agora = new Date();
        let dia = agora.getDate().toString().padStart(2, '0');
        this.set_applet_label(dia);
        this.set_applet_tooltip(`Calendário - ${agora.toLocaleDateString('pt-BR')}`);
    }
    
    _iniciarTimer() {
        // Atualizar a cada minuto
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, Lang.bind(this, function() {
            this._atualizarRotuloApplet();
            
            // Se estiver mostrando o calendário, atualizar se mudou o dia
            if (this.calendarioVisivel) {
                let agora = new Date();
                let dataExibicaoAtual = new Date();
                if (agora.getDate() !== dataExibicaoAtual.getDate() || 
                    agora.getMonth() !== dataExibicaoAtual.getMonth() || 
                    agora.getFullYear() !== dataExibicaoAtual.getFullYear()) {
                    this._atualizarGradeCalendario();
                }
            }
            
            return true;
        }));
    }
    
    on_applet_removed_from_panel() {
        // Limpar timers
        if (this._idTimeoutOcultarAuto) {
            GLib.source_remove(this._idTimeoutOcultarAuto);
        }
        
        // Limpar ator do calendário
        if (this.atorCalendario) {
            this.atorCalendario.destroy();
        }
        
        // Finalizar configurações
        if (this.settings) {
            this.settings.finalize();
        }
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new FloatingCalendarApplet(orientation, panel_height, instance_id);
}
