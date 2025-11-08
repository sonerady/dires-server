const path = require("path");
const swaggerJsdoc = require("swagger-jsdoc");

require("dotenv").config();

const defaultPort = process.env.PORT || 3001;
const serverUrl =
  process.env.SWAGGER_SERVER_URL || `http://localhost:${defaultPort}`;

const swaggerDefinition = {
  openapi: "3.0.0",
  info: {
    title: process.env.SWAGGER_TITLE || "Diress API",
    version: process.env.SWAGGER_VERSION || "1.0.0",
    description:
      process.env.SWAGGER_DESCRIPTION ||
      "Auto-generated documentation for the Diress server API.",
  },
  servers: [
    {
      url: serverUrl,
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  },
};

const swaggerOptions = {
  definition: swaggerDefinition,
  apis: [
    path.join(__dirname, "./routes/**/*.js"),
    path.join(__dirname, "./app.js"),
  ],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

module.exports = swaggerSpec;
