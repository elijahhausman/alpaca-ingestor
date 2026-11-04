Hi there!

This is a small project I've been working on recently. The idea is that it creates a database of stock market data using the Alpaca API, which you can then use to train ML models or such.

The way it works is by creating a WebSocket connection to Alpaca. Once connected, it'll push all the incoming data into a Postgres database using the Prisma ORM. When the application is started, it also backlogs data up to a configurable number of days from the current time. There is also logic to handle disconnections/reconnections and errors, so if you lose internet or such, it'll reconnect and backfill anything it missed.

This project is designed to run in docker, but you can deploy it anywhere you want! You can also turn it into an MCP server for your agents... coming soon!

Contributions are welcome :)
