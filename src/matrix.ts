import { LedMatrix, GpioMapping, LedMatrixInstance } from "rpi-led-matrix"

let cachedMatrix: LedMatrixInstance

type Image = { type: "image"; data: Uint8Array }

export type Animation = {
  type: "animation"
  data: Array<{
    buffer: Uint8Array
    delay: number
  }>
}

let queueLoopRunning = false

export const queue: Array<Animation | Image> = []

const MS_TILL_DIM = 1000 * 60 * 5 // 5 min

function pushToQueue(item: Animation | Image) {
  if (process.env.NODE_ENV !== "production") {
    queue.push(item)
    return
  }

  if (!queueLoopRunning) {
    queueHandler()
    queueLoopRunning = true
  }
  queue.push(item)
}

let retryTimeout: NodeJS.Timeout
function queueHandler() {
  let matrix: LedMatrixInstance
  clearTimeout(retryTimeout)

  try {
    matrix = getMatrix()
  } catch (error) {
    console.error(error)
    console.log("Matrix creating failed. Trying again in 10 seconds")
    retryTimeout = setTimeout(() => queueHandler(), 3000)
    return
  }

  let animationFrame = 0
  let currentStartedShowing = Date.now()
  let currentlyDrawn: Animation | Image | null = null

  function sync() {
    if (queue.length === 0) {
      setTimeout(() => sync(), 3000)
      return
    }

    console.log("Queue length", queue.length)

    let currentQueueItem = queue[0]
    if (queue.length === 1 && currentQueueItem === currentlyDrawn) {
      setTimeout(() => sync(), 3000)
      return
    }

    const timeToChange =
      queue.length > 1 &&
      ((currentQueueItem.type === "animation" &&
        animationFrame >= currentQueueItem.data.length) ||
        (currentQueueItem.type === "image" &&
          Date.now() - currentStartedShowing > 3000))

    if (timeToChange) {
      queue.shift()
      currentQueueItem = queue[0]
      animationFrame = 0
      currentStartedShowing = Date.now()
      currentlyDrawn = currentQueueItem
    }

    const dimming = ((Date.now() - currentStartedShowing) / MS_TILL_DIM) * 70

    if (currentQueueItem.type === "animation") {
      const frameData =
        currentQueueItem.data[animationFrame % currentQueueItem.data.length]
      matrix
        .clear()
        .brightness(70 - dimming)
        .drawBuffer(Buffer.of(...frameData.buffer), 32, 32)
      animationFrame++
      setTimeout(() => matrix.sync(), frameData.delay)
    }
    if (currentQueueItem.type === "image") {
      matrix
        .clear()
        .brightness(70 - dimming)
        .drawBuffer(Buffer.of(...currentQueueItem.data), 32, 32)
      setTimeout(() => matrix.sync(), 5000)
    }
  }

  matrix.afterSync((mat, dt, t) => sync())

  matrix.sync()
}

function getMatrix() {
  if (cachedMatrix) {
    return cachedMatrix
  }

  console.log("Creating matrix")
  cachedMatrix = new LedMatrix(
    {
      ...LedMatrix.defaultMatrixOptions(),
      rows: 32,
      cols: 32,
      chainLength: 1,
      hardwareMapping: GpioMapping.AdafruitHat,
    },
    {
      ...LedMatrix.defaultRuntimeOptions(),
      gpioSlowdown: 0,
    }
  )
  console.log("Matrix created")
  return cachedMatrix
}

export function playAnimation(animation: Animation["data"]) {
  pushToQueue({ type: "animation", data: animation })
}

export function drawImage(array: Uint8Array) {
  pushToQueue({ type: "image", data: array })
}
