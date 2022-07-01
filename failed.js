const {client, getS3File} = require("./util.js")

async function run() {
  // set up restraints for pipelines
  const lookbackDays = 1
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);

  const ignoredJobs = [
    'lint',
    'windows_unit_tests',
    'unit_tests_node14',
    'unit_tests_node16',
    'unit_tests_node18',
    'starters_publish',
    'typecheck', 
    'bootstrap',
    'integration_tests_gatsby_cli',
  ]

  // variable setup
  const branchesBuiltInLookback = new Set()
  const failedJobGroups = {}
  const failedFetches = {}
  let finishedGettingPipelines = false
  let pipelinePageToken = undefined

  // get all branches that were built recently
  // loop until we see an old dated pipeline
  while (!finishedGettingPipelines) {
    const pipelineResults = await client.get(
      'project', 
      'pipeline',
      {
        'page-token': pipelinePageToken,
      }
    )

    pipelinePageToken = pipelineResults.next_page_token

    // add pipeline branches to list to fetch tests for
    for (const pipeline of pipelineResults.items) {
      const pipelineDate = Date.parse(pipeline.updated_at)
      if (pipelineDate > startDate) {
        branchesBuiltInLookback.add(pipeline.vcs.branch)
      } else {
        finishedGettingPipelines = true
        break
      }
    }
  }

  // find workflows for each branch
  for (const branch of Array.from(branchesBuiltInLookback)) {
    let finishedGettingWorkflows = false
    let workflowPageToken = undefined
    const workflows = []

    // loop until we see an old dated pipeline
    while (!finishedGettingWorkflows) {
      if (workflowPageToken === null) {
        finishedGettingWorkflows = true
        break
      }

      const workflowResults = await client.get(
        `insights`,
        `workflows/build-test`,
        {
          branch,
          'page-token': workflowPageToken,
        }
      )

      workflowPageToken = workflowResults.next_page_token

      // find workflows within the date range
      for (const workflow of workflowResults.items) {
        const workflowDate = Date.parse(workflow.created_at)
        if (workflowDate <= startDate) {
          finishedGettingWorkflows = true
          break
        }

        workflows.push(workflow)
      }

      // find failed jobs within all of our workflows
      const failedJobs = []
      for (const workflow of workflows) {
        
        const jobResults = await client.get(
          `workflow`,
          `${workflow.id}/job`,
          {},
          {skipContext: true}
        )

        for (const job of jobResults.items) {
          if (ignoredJobs.indexOf(job.name) < 0 && job.status === 'failed') {
            failedJobs.push(job)
          }
        }
      }

      // parse logs for each failed job
      for (const job of failedJobs) {
        // old API response is garbled, so manually parse logs
        const artifactsResults = await client.get(
          `project`,
          job.job_number,
          {},
          {
            raw: true,
            version: '1.1',
          }
        )

        const outputRegex = /:output_url \"([^"]+)\"/g
        const outputMatches = Array.from(artifactsResults.matchAll(outputRegex))

        if (!outputMatches) {
          continue
        }

        const specialCharsStrip = /\x1B\[(([0-9]+)(;[0-9]+)*)?[m,K,H,f,J]/g
        const failedTestMatch = / │ ✖\s+([^│]+)/g

        // assume the last log was the one that failed
        const logUrl = outputMatches[outputMatches.length - 1][1]
        let log
        try {
          log = await getS3File(logUrl)
        } catch (e) {
          console.log(`Failed to get log file for ${branch}/${job.name}`)
          failedFetches[job.name] = failedFetches[job.name] ? failedFetches[job.name] + 1 : 1
          continue
        }

        const logString = JSON.parse(log).map(l => l.message).join('\n').replace(specialCharsStrip, '')
        const failedLines = logString.matchAll(failedTestMatch)

        if (!failedLines) {
          continue
        }

        for (const failedLine of failedLines) {
          if (!(job.name in failedJobGroups)) {
            failedJobGroups[job.name] = {}
          }

          // Sometimes fileNames are too long and flow to the next line
          // Just going to ignore that for now because it's a bit rare
          const fileName = failedLine[1].split(/\s+/)[0]
      
          if (!(fileName in failedJobGroups[job.name])) {
            failedJobGroups[job.name][fileName] = {
              count: 0,
              lastSeen: 0,
              lastJob: 0,
            }
          }

          failedJobGroups[job.name][fileName].count++
          
          const testDate = Date.parse(job.started_at)
          if (testDate > failedJobGroups[job.name][fileName].lastSeen) {
            failedJobGroups[job.name][fileName].lastJob = job.job_number
            failedJobGroups[job.name][fileName].lastSeen = testDate
          }
        }
      }
    }
  }

  // generate markdown results
  for (const [jobName, tests] of Object.entries(failedJobGroups)) {
    console.log(`# ${jobName}\n`)
    console.log(`*(last ${lookbackDays} days)*\n`)
    console.log(`Test Name | Fail Count | Last Job`)
    console.log(`--- | --- | ---`)

    const results = []
    for (const [testName, metrics] of Object.entries(tests)) {
      const jobUrl = `https://app.circleci.com/pipelines/github/gatsbyjs/gatsby/jobs/${metrics.lastJob}/tests`
      results.push(`${testName} | ${metrics.count} | [${metrics.lastJob}](${jobUrl})`)
    }

    console.log(results.join(`\n`))
    console.log(`\n`)
  }

  console.log(JSON.stringify(failedFetches, null, 2))
}

run()