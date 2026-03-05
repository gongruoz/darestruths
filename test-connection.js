require("dotenv").config();
const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function testConnection() {
  try {
    const response = await notion.databases.retrieve({
      database_id: "31a822d43844806b826ee4fa6fcb3802",
    });
    console.log("连接成功！数据库名称:", response.title[0].plain_text);
  } catch (error) {
    console.error(
      "连接失败，请确认是否已授权该页面，或 ID 是否为数据库而非普通页面:",
      error.message
    );
  }
}

testConnection();
