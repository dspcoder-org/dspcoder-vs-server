FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && \
    apt-get install -y \
    build-essential \
    git \
    curl \
    python3.10 \
    python3.10-dev \
    libkrb5-dev \
    pkg-config \
    libx11-dev \
    libxkbfile-dev \
    jq \
    quilt

# Install Node.js 20 LTS
RUN curl -sL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Install nvm and Node.js 20
# Note: This is a workaround to install nvm and Node.js 20 in the same layer
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash && \
    export NVM_DIR="$HOME/.nvm" && \
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && \
    nvm install 20 && \
    nvm use 20 && \
    nvm alias default 20

# expose port 3000
EXPOSE 8080


RUN cd /home && \
    git clone https://github.com/coder/code-server.git && \
    cd /home/code-server && \
    git submodule update --init && \
    quilt push -a && \
    npm install -g typescript && \
    npm install @coder/logger && \
    npm install
    # npm run build && \
    # VERSION='1.100.2' npm run build:vscode

# Set working directory
WORKDIR /home/code-server



# Use bash as the container's entrypoint with proper syntax to keep it running
CMD ["/bin/bash", "-c", "tail -f /dev/null"]