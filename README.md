# hubot-sealand

Extension for your hubot which integrates with Rancher, Github and Docker Hub.

**NOTE:** if you don't want a services config rewritten add a `label` called
`codebot.dont_rewrite` and set it to `true`.

# HTTP API

* `/up`

    curl -XPOST localhost:8080/up -H 'Content-Type: application/json' -d '{
      "repo": "example/my-repo",
      "commitHash": "e3d6b46",
      "branch": "master",
      "composeFile": "docker-compose.yml"
    }'

# Configurations

We expect `process.env.CONFIG_BUCKET` to be the name of a bucket in s3.

A configuration should look like this:

    $ cat dev.json
    {
        "rancher": {
            "address": "xxxx",
            "projectId": "xxxx",
            "auth": {
                "accessKey": "xxxx",
                "secretKey": "xxxx"
            },
            "lbId": "xxxx"
        },
        "aesKey": "xxxx"
    }
