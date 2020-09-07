FROM node:10

COPY . /app

WORKDIR /app

RUN npm install

EXPOSE 3000
