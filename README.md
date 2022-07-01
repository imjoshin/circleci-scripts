# circleci-scripts

Random scripts I've used to grab circleci data. 
Note: Not much of the config is abstracted, so use at your own risk!

## Setup

```
CIRCLECI_TOKEN="" # set up somewhere, either .env or .*rc
yarn install
```

## Usage

```
yarn $SCRIPT_NAME
```

## Scripts

- `failed`: A script to grab all recent test failures, their logs, and which files failed
- `flaky`: A script to grab all flaky tests from CircleCI's insights