Hi there!

This is a small project I've been working on recently. It's a small Node application that pulls stock market data into a database using the Alpaca API. You can then use this data to ground your agents in actual data or to train ML models and such.

The way it works is by creating a WebSocket connection to Alpaca. Once connected it'll push all the incoming data into a Postgres database using the Prisma ORM. When the application is started, it also backlogs data up to a configurable number of days from the current time. There is also logic to handle disconnections/reconnections and errors, so if you lose internet or such, it'll reconnect and backfill anything it missed.

This project is designed to run in docker, but you can deploy it anywhere you want! I might publish this project into an MCP server for your agents to place trades using the existing data.

Contributions are welcome :)
