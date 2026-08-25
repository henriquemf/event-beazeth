FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Um worker só, e não é economia: o APScheduler roda dentro do processo, então
# dois workers dariam dois agendadores e cada lembrete sairia em duplicata.
#
# As threads é que fazem o worker atender em paralelo. Sem elas o gunicorn usa
# o worker síncrono, que trata UMA requisição por vez: o navegador pede a
# página e mais uma dúzia de CSS/JS ao mesmo tempo, e todos ficavam em fila
# atrás de quem estava esperando o banco responder. O trabalho aqui é de
# espera de rede, não de CPU — exatamente o caso em que thread rende.
#
# Forma shell para o ${PORT} ser expandido — o Render injeta a porta por
# variável de ambiente; o 8000 é o padrão de quem roda o container na mão.
CMD gunicorn -w 1 --threads 8 --timeout 120 -b 0.0.0.0:${PORT:-8000} wsgi:app
