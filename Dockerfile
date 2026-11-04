# Step 1: Use the node:22 base image
FROM node:22

# Step 2: Set the working app directory for build process
WORKDIR /app

# Step 3: Copy project dependencies for install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma

# Step 4: Enable corepack so pnpm can be used
RUN corepack enable

# Step 5: Install dependencies using pnpm
RUN pnpm install --frozen-lockfile

# Step 6: Copy the source code into the image
COPY . .

# Step 7: Run the build inside of the image build so it's output is in the image
RUN pnpm run build

# Step 8: Run prisma migrations and start the app when the container starts
CMD ["sh", "-c", "npx prisma migrate deploy && pnpm start"]
