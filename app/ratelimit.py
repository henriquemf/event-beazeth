"""Freio para tentativa de senha em série.

Sem isto, `/entrar` e `/api/auth/login` aceitam quantos palpites couberem na
banda: uma senha de oito caracteres cai numa tarde, e nada no servidor registra
que isso aconteceu. O scrypt encarece cada tentativa, mas encarecer não é
impedir — e, num plano gratuito de uma CPU, essa mesma conta cara vira o
segundo problema: mil logins errados por minuto derrubam o site para quem está
usando.

**Conta falha, não requisição.** Quem acerta a senha não gasta cota, então
ninguém é barrado por usar o app. O que se limita é errar.

**Duas chaves, e as duas precisam passar.** Por IP pega o ataque de uma máquina
contra muitas contas; por e-mail pega a botnet que distribui os palpites em
muitos IPs contra uma conta só. Qualquer uma sozinha deixa metade do problema
de fora.

**Vive na memória do processo, e isso é uma escolha.** A alternativa era uma
tabela no banco -- uma escrita a cada senha errada, num banco que está noutro
datacenter -- ou um Redis, que seria a primeira dependência de infraestrutura
nova do projeto. O gunicorn aqui roda um worker, então "memória do processo" é
o servidor inteiro. Se um dia forem dois workers, o teto efetivo dobra: ainda
serve para o que este freio existe, que é tirar a força bruta da mesa, não
contar tentativas com precisão contábil.
"""

import os
import threading
import time
from collections import defaultdict, deque

# Vinte erros em quinze minutos, por IP. Quem digita a própria senha errado
# cinco vezes seguidas é raro; vinte é um número que ninguém alcança sem estar
# tentando adivinhar.
IP_MAX = 20
IP_JANELA = 15 * 60

# Por conta o teto é mais baixo: aqui o alvo é específico, e a pessoa dona da
# conta ainda tem a cota do próprio IP, que é a que ela usa de verdade.
CONTA_MAX = 10
CONTA_JANELA = 15 * 60

# Teto de chaves guardadas. Sem ele, um ataque de muitos IPs faria o dicionário
# crescer sem fim -- trocar força bruta por consumo de memória seria um péssimo
# negócio. Ao estourar, a chave mais antiga sai; quem estourou o teto continua
# barrado pela outra chave (IP e conta são contados em separado).
MAX_CHAVES = 20_000


class Freio:
    """Janela deslizante de falhas por chave."""

    def __init__(self, maximo: int, janela: int):
        self._maximo = maximo
        self._janela = janela
        self._falhas: dict[str, deque] = defaultdict(deque)
        self._trava = threading.Lock()

    def _limpar(self, fila: deque, agora: float) -> None:
        while fila and agora - fila[0] > self._janela:
            fila.popleft()

    def espera(self, chave: str) -> int:
        """Segundos que faltam para liberar. Zero significa livre."""
        agora = time.monotonic()
        with self._trava:
            fila = self._falhas.get(chave)
            if not fila:
                return 0
            self._limpar(fila, agora)
            if len(fila) < self._maximo:
                return 0
            return max(1, int(self._janela - (agora - fila[0])) + 1)

    def registrar_falha(self, chave: str) -> None:
        agora = time.monotonic()
        with self._trava:
            fila = self._falhas[chave]
            self._limpar(fila, agora)
            fila.append(agora)
            if len(self._falhas) > MAX_CHAVES:
                self._falhas.pop(next(iter(self._falhas)), None)

    def limpar_chave(self, chave: str) -> None:
        """Acertou a senha: a conta volta a zero.

        Só a chave que acertou. O IP continua com o que gastou -- quem varre
        contas alheias acaba acertando uma cedo ou tarde, e zerar o IP ali
        daria fôlego novo justamente para quem não devia ter."""
        with self._trava:
            self._falhas.pop(chave, None)

    def zerar(self) -> None:
        """Só para teste: começa do zero sem subir o app de novo."""
        with self._trava:
            self._falhas.clear()


_por_ip = Freio(IP_MAX, IP_JANELA)
_por_conta = Freio(CONTA_MAX, CONTA_JANELA)

# Criar conta é a exceção ao "conta falha, não requisição": ali o ACERTO é o
# que custa -- um scrypt e um punhado de linhas no banco a cada conta nova, e
# nada impedia um script de criar milhares. Dez por hora por IP é mais do que
# uma casa inteira cria num ano.
CONTAS_NOVAS_MAX = 10
CONTAS_NOVAS_JANELA = 60 * 60
_contas_novas = Freio(CONTAS_NOVAS_MAX, CONTAS_NOVAS_JANELA)


def _ip(request) -> str:
    """O IP de quem pediu, atrás do proxy do Render.

    NÃO é o primeiro valor do `X-Forwarded-For`. Os proxies do Render
    (Cloudflare e o balanceador) ACRESCENTAM ao cabeçalho que o cliente mandou,
    então quem escreve `X-Forwarded-For: 1.2.3.4` no próprio pedido escolhe o
    primeiro valor -- e com um número novo a cada palpite o freio por IP nunca
    enchia. O Cloudflare põe o IP de quem se conectou a ele em
    `True-Client-IP`, por cima do que viesse; é esse que vale lá.

    Fora do Render (desenvolvimento, `docker run` na mão) não há proxy nenhum,
    e qualquer um desses cabeçalhos seria só texto do cliente: vale o endereço
    da conexão.
    """
    if os.getenv("RENDER"):
        real = request.headers.get("True-Client-IP", "").strip()
        if real:
            return real
        # Sem o cabeçalho do Cloudflare, o último valor seria o balanceador --
        # o mesmo para o mundo todo, e vinte senhas erradas de qualquer um
        # barrariam o login de todos. Fica o primeiro: forjável, mas o freio
        # por conta, que não depende de IP, continua segurando cada conta.
        encaminhado = request.headers.get("X-Forwarded-For", "")
        if encaminhado:
            return encaminhado.split(",")[0].strip()
    return request.remote_addr or "desconhecido"


def espera_para_tentar(request, email: str) -> int:
    """Segundos que faltam antes de aceitar outra tentativa. Zero = pode."""
    return max(
        _por_ip.espera(f"ip:{_ip(request)}"),
        _por_conta.espera(f"conta:{(email or '').strip().lower()}"),
    )


def registrar_falha(request, email: str) -> None:
    _por_ip.registrar_falha(f"ip:{_ip(request)}")
    _por_conta.registrar_falha(f"conta:{(email or '').strip().lower()}")


def registrar_acerto(request, email: str) -> None:
    _por_conta.limpar_chave(f"conta:{(email or '').strip().lower()}")


def espera_para_criar_conta(request) -> int:
    """Segundos até este IP poder criar outra conta. Zero = pode."""
    return _contas_novas.espera(f"ip:{_ip(request)}")


def registrar_conta_criada(request) -> None:
    _contas_novas.registrar_falha(f"ip:{_ip(request)}")


def zerar_tudo() -> None:
    """Só para teste."""
    _por_ip.zerar()
    _por_conta.zerar()
    _contas_novas.zerar()
