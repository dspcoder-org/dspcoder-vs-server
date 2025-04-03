# DSPCoder-server

#### Clone and build dev container
    docker build --platform linux/amd64 -t dspcoder-vs-server .

    Start Container:
    docker run -d --name container-dspcoder-vs-server --cpus=2 --memory=2g --memory-swap=2g --blkio-weight=500 -p 3000:3000 dspcoder-vs-server


#### steps to build and development (Experimental) :
    After this gets concluded, a script can automate the following steps:
    cd lib && git clone https://github.com/microsoft/vscode.git
    checkout vscode -> ddc367e
    npm install 
    npm run build
