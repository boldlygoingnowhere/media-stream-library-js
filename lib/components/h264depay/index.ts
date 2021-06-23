import { Tube } from '../component'
import { Transform } from 'stream'
import { MessageType, Message } from '../message'
import { VideoMedia } from '../../utils/protocols/sdp'
import { marker, payloadType } from '../../utils/protocols/rtp'
import { H264DepayParser, NAL_TYPES } from './parser'

export class H264Depay extends Tube {
  constructor() {
    let h264PayloadType: number
    let idrFound = false
    let packets: Buffer[] = []

    const h264DepayParser = new H264DepayParser()

    // Incoming

    const incoming = new Transform({
      objectMode: true,
      transform: function (msg: Message, _encoding, callback) {
        // Get correct payload types from sdp to identify video and audio
        if (msg.type === MessageType.SDP) {
          const h264Media = msg.sdp.media.find((media): media is VideoMedia => {
            return (
              media.type === 'video' &&
              media.rtpmap !== undefined &&
              media.rtpmap.encodingName === 'H264'
            )
          })
          if (h264Media !== undefined && h264Media.rtpmap !== undefined) {
            h264PayloadType = h264Media.rtpmap.payloadType
          }
          callback(undefined, msg) // Pass on the original SDP message
        } else if (
          msg.type === MessageType.RTP &&
          payloadType(msg.data) === h264PayloadType
        ) {
          const h264Message = h264DepayParser.parse(msg)
          // Skip if not a full H264 frame
          // Also, don't forward non-IDR frames until an IDR frame has been received
          if (h264Message === null ||
            (!idrFound && h264Message.nalType === NAL_TYPES.NON_IDR_PICTURE)) {
            callback()
            return
          }

          if (h264Message.nalType === NAL_TYPES.IDR_PICTURE) {
            idrFound = true
          }

          //if (h264Message.nalType === NAL_TYPES.SPS || h264Message.nalType === NAL_TYPES.PPS) {
          //  console.log('Got ' + (h264Message.nalType === NAL_TYPES.SPS ? 'SPS' : 'PPS') + ': ' + h264Message.data.toString('hex'))
          //}

          // H.264 over RTP uses the RTP marker bit to indicate a complete
          // frame.  At this point, the packets can be used to construct a
          // complete message. This is not applicable to SPS and PPS frames.

          let endOfFrame
          if (h264Message.nalType === NAL_TYPES.SPS || h264Message.nalType === NAL_TYPES.PPS) {
            endOfFrame = true
          } else {
            endOfFrame = marker(msg.data)
          }

          packets.push(h264Message.data)
          if (endOfFrame) {
            this.push({
              ...h264Message,
              data: packets.length === 1 ? packets[0] : Buffer.concat(packets),
            })
            packets = []
          }
          callback()
        } else {
          // Not a message we should handle
          callback(undefined, msg)
        }
      },
    })

    // outgoing will be defaulted to a PassThrough stream
    super(incoming)
  }
}
