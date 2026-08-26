"""Gera os ícones PNG do app a partir do desenho do `icon.svg`.

Por que existir, se já temos um SVG: o Android não aceita SVG como ícone de
app. O Chrome resolve com o SVG na aba, mas o instalador do Android (e o
Bubblewrap, que empacota o .apk) exige PNG em tamanhos fixos — sem eles o
ícone sai borrado ou o empacotamento falha.

Roda só quando o desenho muda; os PNGs ficam versionados junto com o resto dos
estáticos. Pillow é dependência DESTA ferramenta, não do app — por isso não
está no requirements.txt:

    pip install Pillow
    python tools/generate_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw


DESTINO = Path(__file__).resolve().parent.parent / "app" / "static"

FUNDO = (42, 23, 53, 255)        # #2a1735
GRADIENTE_DE = (255, 120, 178)   # #ff78b2
GRADIENTE_ATE = (126, 200, 255)  # #7ec8ff
SORRISO = (255, 216, 235, 255)   # #ffd8eb

# Caixa que o desenho ocupa dentro do viewBox 0-128 do SVG: do topo do círculo
# (centro 50, raio 22) até a base do sorriso. O SVG tem margem sobrando em
# volta, e é por isso que o maskable é posicionado por ESTA caixa e não pela
# tela — escalar a tela inteira encolheria o desenho duas vezes.
ARTE = (40, 28, 88, 92)  # esquerda, topo, direita, base

# O ícone "maskable" é recortado pelo sistema em círculo, quadrado arredondado
# ou o que o launcher quiser: só se pode contar com os 80% centrais, a "safe
# zone" da especificação. O desenho ocupa esta fração desse diâmetro seguro —
# menos que 1 para sobrar respiro, já que encostar na borda da zona segura fica
# apertado num recorte circular.
OCUPACAO_SEGURA = 0.82
ZONA_SEGURA = 0.80

# Fator de supersampling: desenhamos grande e reduzimos, que é como se obtém
# borda lisa sem antialiasing nativo no Pillow.
SUPER = 4


def _gradiente_diagonal(lado: int) -> Image.Image:
    """Gradiente do canto superior esquerdo ao inferior direito."""
    grade = Image.new("RGB", (lado, lado))
    pixels = grade.load()
    for y in range(lado):
        for x in range(lado):
            # A diagonal normalizada dá o mesmo eixo do `linearGradient` do SVG.
            t = (x + y) / (2 * (lado - 1)) if lado > 1 else 0
            pixels[x, y] = tuple(
                round(de + (ate - de) * t)
                for de, ate in zip(GRADIENTE_DE, GRADIENTE_ATE)
            )
    return grade


def desenhar(lado: int, maskable: bool) -> Image.Image:
    grande = lado * SUPER
    tela = Image.new("RGBA", (grande, grande), (0, 0, 0, 0))
    pincel = ImageDraw.Draw(tela)

    if maskable:
        # Fundo sangrando até a borda: o recorte do sistema nunca deve revelar
        # transparência nos cantos.
        pincel.rectangle([0, 0, grande, grande], fill=FUNDO)

        # Escala pela maior dimensão do DESENHO, para ele preencher a zona
        # segura, e centralização pelo centro do desenho — que não é o centro
        # da tela, porque o sorriso puxa a composição para baixo.
        maior = max(ARTE[2] - ARTE[0], ARTE[3] - ARTE[1])
        escala = (ZONA_SEGURA * OCUPACAO_SEGURA * 128) / maior
        centro_arte_x = (ARTE[0] + ARTE[2]) / 2
        centro_arte_y = (ARTE[1] + ARTE[3]) / 2
        desloca_x = grande / 2 - centro_arte_x / 128 * grande * escala
        desloca_y = grande / 2 - centro_arte_y / 128 * grande * escala
    else:
        raio = grande * 28 / 128
        margem = grande * 8 / 128
        pincel.rounded_rectangle(
            [margem, margem, grande - margem, grande - margem],
            radius=raio,
            fill=FUNDO,
        )
        escala = 1.0
        desloca_x = desloca_y = 0

    def em(valor: float) -> float:
        """Coordenada horizontal do viewBox 0-128 do SVG para o pixel de saída."""
        return desloca_x + valor / 128 * grande * escala

    def emy(valor: float) -> float:
        """Idem, na vertical."""
        return desloca_y + valor / 128 * grande * escala

    # Rosto: círculo com o gradiente, recortado por máscara.
    centro_x, centro_y, raio_rosto = em(64), emy(50), (22 / 128) * grande * escala
    caixa = [centro_x - raio_rosto, centro_y - raio_rosto,
             centro_x + raio_rosto, centro_y + raio_rosto]

    lado_grad = max(1, round(raio_rosto * 2))
    gradiente = _gradiente_diagonal(lado_grad).convert("RGBA")
    mascara = Image.new("L", (lado_grad, lado_grad), 0)
    ImageDraw.Draw(mascara).ellipse([0, 0, lado_grad - 1, lado_grad - 1], fill=255)
    tela.paste(gradiente, (round(caixa[0]), round(caixa[1])), mascara)

    # Sorriso: o `path` do SVG é uma curva rasa; um arco de mesma corda e altura
    # fica visualmente idêntico nos tamanhos em que o ícone é visto.
    largura_traco = max(1, round((8 / 128) * grande * escala))
    pincel.arc(
        [em(40), emy(82) - largura_traco * 1.6, em(88), emy(82) + largura_traco * 3.4],
        start=0, end=180,
        fill=SORRISO, width=largura_traco,
    )

    return tela.resize((lado, lado), Image.LANCZOS)


def main() -> None:
    saidas = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
    ]
    for nome, lado, maskable in saidas:
        caminho = DESTINO / nome
        desenhar(lado, maskable).save(caminho, "PNG", optimize=True)
        print("%-26s %4dx%-4d %6d bytes" % (nome, lado, lado, caminho.stat().st_size))


if __name__ == "__main__":
    main()
