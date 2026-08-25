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
# Forma shell para o ${PORT} ser expandido — o Render injeta a porta por
# variável de ambiente; o 8000 é o padrão de quem roda o container na mão.
CMD gunicorn -w 1 -b 0.0.0.0:${PORT:-8000} wsgi:app
